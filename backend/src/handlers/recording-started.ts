/**
 * EventBridge handler for IVS Recording Start events
 * Updates session recording status when recording begins
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { updateRecordingMetadata } from '../repositories/session-repository';

const logger = new Logger({
  serviceName: 'vnl-events',
  persistentKeys: { handler: 'recording-started' },
});

interface RecordingStartDetail {
  channel_arn?: string;
  stage_arn?: string;
  recording_s3_key_prefix: string;
  event_name: 'Recording Start';
}

export const handler = async (
  event: EventBridgeEvent<'IVS Recording State Change', RecordingStartDetail>
): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  const resourceArn = event.detail.channel_arn || event.detail.stage_arn;

  if (!resourceArn) {
    logger.warn('Recording Start event missing both channel_arn and stage_arn');
    return;
  }

  if (!resourceArn.startsWith('arn:aws:ivs')) {
    logger.warn('Invalid resource ARN format', { resourceArn });
    return;
  }

  logger.info('Recording Start event received', { resourceArn });

  const docClient = getDocumentClient();

  try {
    // Find session by resource ARN (check both channel and stage)
    const scanResult = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :session) AND (claimedResources.#channel = :arn OR claimedResources.#stage = :arn)',
      ExpressionAttributeNames: {
        '#channel': 'channel',
        '#stage': 'stage',
      },
      ExpressionAttributeValues: {
        ':session': 'SESSION#',
        ':arn': resourceArn,
      },
    }));

    if (!scanResult.Items || scanResult.Items.length === 0) {
      logger.warn('No session found for resource', { resourceArn });
      return;
    }

    const session = scanResult.Items[0];
    const sessionId = session.sessionId;
    logger.appendPersistentKeys({ sessionId });

    logger.info('Updating recording status to processing');

    // Update recording metadata
    await updateRecordingMetadata(tableName, sessionId, {
      recordingStatus: 'processing',
      recordingS3Path: event.detail.recording_s3_key_prefix,
    });

    logger.info('Recording metadata updated');
  } catch (error: any) {
    logger.error('Failed to update recording metadata', { errorMessage: error.message });
    // Don't throw - EventBridge will retry on error
  }
};
