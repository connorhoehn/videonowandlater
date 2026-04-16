/**
 * EventBridge handler for IVS Stream End events
 * Transitions session from LIVE to ENDING when the broadcast stream stops.
 * Recording processing continues asynchronously; recording-ended.ts handles ENDING → ENDED.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { updateSessionStatus, findSessionByChannelArn } from '../repositories/session-repository';
import { SessionStatus } from '../domain/session';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({
  serviceName: 'vnl-events',
  persistentKeys: { handler: 'stream-ended' },
});

interface StreamEndDetail {
  event_name: 'Stream End';
  channel_name: string;
  channel_arn: string;
  stream_id: string;
}

export const handler = async (
  event: EventBridgeEvent<'IVS Stream State Change', StreamEndDetail>
): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  // IVS Stream State Change: channel ARN is in event.resources[0]
  // detail.channel_arn does not exist for stream state change events
  const channelArn = event.resources?.[0];

  if (!channelArn || !channelArn.startsWith('arn:aws:ivs:')) {
    logger.warn('Invalid or missing channel ARN in event', { resources: event.resources });
    return;
  }

  logger.info('Stream End event received', { channelArn });

  // Query GSI3 for session by channel ARN (O(1) vs full-table scan)
  const session = await findSessionByChannelArn(tableName, channelArn);

  if (!session) {
    logger.warn('No session found for channel', { channelArn });
    return;
  }

  const sessionId = session.sessionId;
  logger.appendPersistentKeys({ sessionId });

  logger.info('Transitioning session LIVE → ENDING');

  try {
    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');
    logger.info('Session transitioned to ENDING');

    try {
      await emitSessionEvent(tableName, {
        eventId: uuidv4(), sessionId, eventType: SessionEventType.STREAM_ENDED,
        timestamp: new Date().toISOString(), actorId: 'IVS',
        actorType: 'ivs', details: { channelArn },
      });
    } catch { /* non-blocking */ }
  } catch (error: any) {
    // Gracefully handle concurrent transitions (e.g., end-session already moved it)
    if (error.name === 'ConditionalCheckFailedException' || error.message?.includes('Invalid transition')) {
      logger.warn('Session already transitioned (concurrent update)', {
        errorMessage: error.message,
      });
    } else {
      logger.error('Failed to update session status', { errorMessage: error.message });
    }
  }
};
