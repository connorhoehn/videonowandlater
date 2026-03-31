/**
 * EventBridge handler for IVS Recording Start events
 * Updates session recording status when recording begins
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { updateRecordingMetadata, findSessionByChannelArn, findSessionByStageArn } from '../repositories/session-repository';

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

  try {
    // Query GSI3/GSI4 for session by resource ARN (O(1) vs full-table scan)
    const isChannel = resourceArn.includes(':channel/');
    const session = isChannel
      ? await findSessionByChannelArn(tableName, resourceArn)
      : await findSessionByStageArn(tableName, resourceArn);

    if (!session) {
      logger.warn('No session found for resource', { resourceArn });
      return;
    }

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
