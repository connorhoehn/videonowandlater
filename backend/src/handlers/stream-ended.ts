/**
 * EventBridge handler for IVS Stream End events
 * Transitions session from LIVE to ENDING when the broadcast stream stops.
 * Recording processing continues asynchronously; recording-ended.ts handles ENDING → ENDED.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { updateSessionStatus } from '../repositories/session-repository';
import { SessionStatus } from '../domain/session';

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

  const docClient = getDocumentClient();

  const scanResult = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'begins_with(PK, :session) AND claimedResources.#channel = :channelArn',
    ExpressionAttributeNames: {
      '#channel': 'channel',
    },
    ExpressionAttributeValues: {
      ':session': 'SESSION#',
      ':channelArn': channelArn,
    },
  }));

  if (!scanResult.Items || scanResult.Items.length === 0) {
    logger.warn('No session found for channel', { channelArn });
    return;
  }

  const session = scanResult.Items[0];
  const sessionId = session.sessionId;
  logger.appendPersistentKeys({ sessionId });

  logger.info('Transitioning session LIVE → ENDING');

  try {
    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');
    logger.info('Session transitioned to ENDING');
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
