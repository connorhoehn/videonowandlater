/**
 * Cron Lambda: EventBridge rate(5 minutes).
 *
 * Phase 5: scheduled sessions.
 *
 * - Finds SCHEDULED sessions where now falls inside
 *     [scheduledFor - 10min, scheduledFor + 5min]
 *   and emits SESSION_READY_TO_START so the host UI can nudge them.
 *
 * - Auto-cancels SCHEDULED sessions where scheduledFor + 60min < now
 *   (host no-show). Status flips to CANCELED and SESSION_CANCELED is emitted.
 *
 * All work is best-effort; individual failures are logged and never
 * block the rest of the batch.
 */

import type { Handler } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { SessionStatus } from '../domain/session';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'auto-start-scheduled-session' },
});

const READY_LEAD_MS = 10 * 60 * 1000;       // emit READY_TO_START 10 min before
const READY_LATE_MS = 5 * 60 * 1000;        //   through 5 min after scheduled time
const NO_SHOW_CANCEL_MS = 60 * 60 * 1000;   // auto-cancel if host never goes live

export const handler: Handler = async (): Promise<void> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    logger.error('TABLE_NAME not set');
    return;
  }

  const docClient = getDocumentClient();
  const nowMs = Date.now();
  const readyWindowStart = new Date(nowMs - READY_LATE_MS).toISOString();   // scheduledFor <= now + 5min  ⇒ scheduledFor >= now - 5min (not applicable here) — we scan ALL scheduled then filter
  const readyWindowEnd = new Date(nowMs + READY_LEAD_MS).toISOString();
  const noShowCutoff = new Date(nowMs - NO_SHOW_CANCEL_MS).toISOString();

  // Scan all SCHEDULED sessions; filter in memory. Volume is low (scheduled
  // events are far less frequent than live sessions) so this is cheap.
  let items: Record<string, any>[] = [];
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'STATUS#SCHEDULED' },
    }));
    items = result.Items ?? [];
  } catch (err: any) {
    logger.error('Query STATUS#SCHEDULED failed', { error: err.message });
    return;
  }

  let readyCount = 0;
  let canceledCount = 0;

  for (const s of items) {
    const sessionId = s.sessionId as string;
    const scheduledFor = s.scheduledFor as string | undefined;
    if (!sessionId || !scheduledFor) continue;

    // Auto-cancel no-show: scheduledFor + 60min < now
    if (scheduledFor < noShowCutoff) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #status = :canceled, GSI1PK = :gsiPk, #version = #version + :inc',
          ConditionExpression: '#status = :scheduled',
          ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
          ExpressionAttributeValues: {
            ':canceled': SessionStatus.CANCELED,
            ':scheduled': SessionStatus.SCHEDULED,
            ':gsiPk': `STATUS#${SessionStatus.CANCELED.toUpperCase()}`,
            ':inc': 1,
          },
        }));

        try {
          await emitSessionEvent(tableName, {
            eventId: uuidv4(),
            sessionId,
            eventType: SessionEventType.SESSION_CANCELED,
            timestamp: new Date().toISOString(),
            actorId: 'system',
            actorType: 'system',
            details: { reason: 'host_no_show', scheduledFor },
          });
        } catch { /* non-blocking */ }

        canceledCount++;
        logger.info('Auto-canceled no-show scheduled session', { sessionId, scheduledFor });
      } catch (err: any) {
        if (err.name !== 'ConditionalCheckFailedException') {
          logger.warn('Auto-cancel failed', { sessionId, error: err.message });
        }
      }
      continue;
    }

    // Emit READY_TO_START for sessions in the notification window.
    if (scheduledFor >= readyWindowStart && scheduledFor <= readyWindowEnd) {
      try {
        await emitSessionEvent(tableName, {
          eventId: uuidv4(),
          sessionId,
          eventType: SessionEventType.SESSION_READY_TO_START,
          timestamp: new Date().toISOString(),
          actorId: 'system',
          actorType: 'system',
          details: { scheduledFor, hostUserId: s.userId },
        });
        readyCount++;
      } catch (err: any) {
        logger.warn('Failed to emit SESSION_READY_TO_START', { sessionId, error: err.message });
      }
    }
  }

  logger.info('Scheduled-session scan complete', {
    totalScheduled: items.length,
    readyCount,
    canceledCount,
  });
};
