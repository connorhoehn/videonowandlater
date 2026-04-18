/**
 * Cron Lambda: auto-kill runaway sessions + auto-finalize stuck ENDING sessions.
 *
 * - LIVE sessions with createdAt older than ACTIVE_SESSION_MAX_AGE_MIN → kill
 *   (stop stream / disconnect participants / chat notify / write audit / release pool / status → ENDING)
 * - ENDING sessions with endedAt older than ENDING_MAX_AGE_MIN → force status → ENDED + release pool
 *
 * Runs every minute via EventBridge.
 */

import type { Handler } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { IvsClient, StopStreamCommand } from '@aws-sdk/client-ivs';
import { IVSRealTimeClient, DisconnectParticipantCommand } from '@aws-sdk/client-ivs-realtime';
import { IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getHangoutParticipants, updateSessionStatus } from '../repositories/session-repository';
import { releasePoolResource } from '../repositories/resource-pool-repository';
import { SessionStatus, SessionType } from '../domain/session';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'scan-active-sessions' },
});

const ivsClient = new IvsClient({});
const ivsRealtimeClient = new IVSRealTimeClient({});
const ivsChatClient = new IvschatClient({});

const ACTIVE_SESSION_MAX_AGE_MS =
  parseInt(process.env.ACTIVE_SESSION_MAX_AGE_MIN ?? '10', 10) * 60 * 1000;
const ENDING_MAX_AGE_MS =
  parseInt(process.env.ENDING_MAX_AGE_MIN ?? '2', 10) * 60 * 1000;
const SYSTEM_ACTOR = 'system';
const AUTO_KILL_REASON = 'Auto-killed: session exceeded max duration';

async function queryByStatus(tableName: string, statusPartition: string): Promise<Record<string, any>[]> {
  try {
    const result = await getDocumentClient().send(new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': statusPartition },
    }));
    return result.Items ?? [];
  } catch (err: any) {
    logger.error(`Query failed (non-blocking): ${statusPartition}`, { errorMessage: err.message });
    return [];
  }
}

async function releaseClaimedResources(tableName: string, session: any): Promise<void> {
  const claimed = session.claimedResources ?? {};
  for (const key of ['channel', 'stage', 'chatRoom'] as const) {
    if (claimed[key]) {
      try {
        await releasePoolResource(tableName, claimed[key]);
      } catch (err: any) {
        logger.warn('Pool release failed', { sessionId: session.sessionId, key, errorMessage: err.message });
      }
    }
  }
}

async function killLiveSession(tableName: string, session: any): Promise<void> {
  const sessionId: string = session.sessionId;
  const previousStatus: string = session.status;

  // Stop broadcast stream
  if (session.sessionType === SessionType.BROADCAST && session.channelArn) {
    try {
      await ivsClient.send(new StopStreamCommand({ channelArn: session.channelArn }));
    } catch (err: any) {
      logger.warn('StopStream failed', { sessionId, errorMessage: err.message });
    }
  }

  // Disconnect hangout participants
  if (session.sessionType === SessionType.HANGOUT && session.stageArn) {
    const participants = await getHangoutParticipants(tableName, sessionId);
    for (const p of participants) {
      try {
        await ivsRealtimeClient.send(new DisconnectParticipantCommand({
          stageArn: session.stageArn,
          participantId: p.participantId,
          reason: AUTO_KILL_REASON,
        }));
      } catch (err: any) {
        logger.warn('DisconnectParticipant failed', { sessionId, participantId: p.participantId, errorMessage: err.message });
      }
    }
  }

  // Chat kill notification
  if (session.claimedResources?.chatRoom) {
    try {
      await ivsChatClient.send(new SendEventCommand({
        roomIdentifier: session.claimedResources.chatRoom,
        eventName: 'session_killed',
        attributes: { reason: AUTO_KILL_REASON, killedBy: SYSTEM_ACTOR },
      }));
    } catch (err: any) {
      logger.warn('Chat kill event failed', { sessionId, errorMessage: err.message });
    }
  }

  // Transition to ENDING
  await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');

  try {
    await emitSessionEvent(tableName, {
      eventId: uuidv4(), sessionId, eventType: SessionEventType.SESSION_ENDING,
      timestamp: new Date().toISOString(), actorId: SYSTEM_ACTOR,
      actorType: 'user', details: { reason: AUTO_KILL_REASON, adminAction: true, killedBy: SYSTEM_ACTOR },
    });
  } catch { /* non-blocking */ }

  // Audit
  const createdAt = new Date().toISOString();
  await getDocumentClient().send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `MOD#${createdAt}#${uuidv4()}`,
      entityType: 'MODERATION',
      actionType: 'AUTO_KILL',
      actorId: SYSTEM_ACTOR,
      reason: AUTO_KILL_REASON,
      sessionId,
      createdAt,
      sessionType: session.sessionType,
      previousStatus,
      GSI5PK: 'MODERATION',
      GSI5SK: createdAt,
    },
  }));

  await releaseClaimedResources(tableName, session);

  logger.info('Auto-killed LIVE session', { sessionId, sessionType: session.sessionType });
}

async function finalizeStuckEnding(tableName: string, session: any): Promise<void> {
  const sessionId: string = session.sessionId;
  await updateSessionStatus(tableName, sessionId, SessionStatus.ENDED);
  await releaseClaimedResources(tableName, session);
  logger.info('Force-finalized stuck ENDING session', { sessionId });
}

export const handler: Handler = async (): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  const now = Date.now();
  const liveCutoff = new Date(now - ACTIVE_SESSION_MAX_AGE_MS).toISOString();
  const endingCutoff = new Date(now - ENDING_MAX_AGE_MS).toISOString();

  const [liveItems, endingItems] = await Promise.all([
    queryByStatus(tableName, 'STATUS#LIVE'),
    queryByStatus(tableName, 'STATUS#ENDING'),
  ]);

  const staleLive = liveItems.filter((s) => s.createdAt && s.createdAt < liveCutoff);
  const staleEnding = endingItems.filter((s) => s.endedAt && s.endedAt < endingCutoff);

  logger.info('Scan complete', {
    liveTotal: liveItems.length,
    endingTotal: endingItems.length,
    liveStale: staleLive.length,
    endingStale: staleEnding.length,
  });

  // Process sequentially to avoid thundering-herd on IVS APIs
  for (const s of staleLive) {
    try {
      await killLiveSession(tableName, s);
    } catch (err: any) {
      logger.error('Auto-kill failed (non-blocking)', { sessionId: s.sessionId, errorMessage: err.message });
    }
  }
  for (const s of staleEnding) {
    try {
      await finalizeStuckEnding(tableName, s);
    } catch (err: any) {
      logger.error('Force-finalize failed (non-blocking)', { sessionId: s.sessionId, errorMessage: err.message });
    }
  }
};
