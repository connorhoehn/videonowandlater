/**
 * POST /admin/sessions/{sessionId}/kill
 * Admin-only endpoint to forcefully terminate a live session.
 * Stops the stream/stage, notifies chat, transitions to ENDING, and writes an audit record.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById, getHangoutParticipants, updateSessionStatus } from '../repositories/session-repository';
import { releasePoolResource } from '../repositories/resource-pool-repository';
import { SessionStatus, SessionType } from '../domain/session';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { IvsClient, StopStreamCommand } from '@aws-sdk/client-ivs';
import { IVSRealTimeClient, DisconnectParticipantCommand } from '@aws-sdk/client-ivs-realtime';
import { IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import { getDocumentClient } from '../lib/dynamodb-client';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-kill-session' } });

const ivsClient = new IvsClient({});
const ivsRealtimeClient = new IVSRealTimeClient({});
const ivsChatClient = new IvschatClient({});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  // 1. Check admin auth
  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  // 2. Parse sessionId and optional reason
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  let reason = 'Terminated by admin';
  if (event.body) {
    try {
      const body = JSON.parse(event.body);
      if (body.reason) reason = body.reason;
    } catch {
      // ignore parse errors, use default reason
    }
  }

  try {
    // 3. Get session
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    const previousStatus = session.status;

    // 4. If session already ENDED, return 200 no-op
    if (session.status === SessionStatus.ENDED) {
      return resp(200, { message: 'Session already ended', sessionId, status: 'ended' });
    }

    // 5. For BROADCAST: stop the stream
    if (session.sessionType === SessionType.BROADCAST && session.channelArn) {
      try {
        await ivsClient.send(new StopStreamCommand({ channelArn: session.channelArn }));
        logger.info('Stopped broadcast stream', { sessionId, channelArn: session.channelArn });
      } catch (err) {
        logger.warn('StopStream failed (stream may already be stopped)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 6. For HANGOUT: disconnect all participants
    if (session.sessionType === SessionType.HANGOUT && session.stageArn) {
      const participants = await getHangoutParticipants(tableName, sessionId);
      for (const p of participants) {
        try {
          await ivsRealtimeClient.send(
            new DisconnectParticipantCommand({
              stageArn: session.stageArn,
              participantId: p.participantId,
              reason: 'Session terminated by admin',
            }),
          );
          logger.info('Disconnected participant', { sessionId, participantId: p.participantId });
        } catch (err) {
          logger.warn('DisconnectParticipant failed', {
            participantId: p.participantId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 7. Send chat kill notification
    if (session.claimedResources?.chatRoom) {
      try {
        await ivsChatClient.send(
          new SendEventCommand({
            roomIdentifier: session.claimedResources.chatRoom,
            eventName: 'session_killed',
            attributes: {
              reason,
              killedBy: adminUserId,
            },
          }),
        );
        logger.info('Sent chat kill notification', { sessionId });
      } catch (err) {
        logger.warn('SendEvent (chat kill notification) failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 8. Transition to ENDING
    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');
    logger.info('Admin killed session — transitioned to ENDING', { sessionId, adminUserId, reason });

    try {
      await emitSessionEvent(tableName, {
        eventId: uuidv4(), sessionId, eventType: SessionEventType.SESSION_ENDING,
        timestamp: new Date().toISOString(), actorId: adminUserId,
        actorType: 'user', details: { reason, adminAction: true, killedBy: adminUserId },
      });
    } catch { /* non-blocking */ }

    // 9. Write audit record
    const createdAt = new Date().toISOString();
    const docClient = getDocumentClient();
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: `MOD#${createdAt}#${uuidv4()}`,
          entityType: 'MODERATION',
          actionType: 'ADMIN_KILL',
          actorId: adminUserId,
          reason,
          sessionId,
          createdAt,
          sessionType: session.sessionType,
          previousStatus,
          GSI5PK: 'MODERATION',
          GSI5SK: createdAt,
        },
      }),
    );

    // 10. Release pool resources (best-effort)
    try {
      if (session.claimedResources?.channel) {
        await releasePoolResource(tableName, session.claimedResources.channel);
      }
      if (session.claimedResources?.stage) {
        await releasePoolResource(tableName, session.claimedResources.stage);
      }
      if (session.claimedResources?.chatRoom) {
        await releasePoolResource(tableName, session.claimedResources.chatRoom);
      }
    } catch (releaseErr) {
      logger.warn('Resource release failed', {
        error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
      });
    }

    // 11. Return success
    return resp(200, { message: 'Session killed', sessionId, status: 'ending' });
  } catch (err: any) {
    logger.error('Error killing session', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
