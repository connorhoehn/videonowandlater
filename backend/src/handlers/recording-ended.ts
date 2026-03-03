/**
 * EventBridge handler for IVS Recording End events
 * Transitions session from ENDING to ENDED and releases pool resources
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { updateSessionStatus, updateRecordingMetadata } from '../repositories/session-repository';
import { releasePoolResource } from '../repositories/resource-pool-repository';
import { SessionStatus } from '../domain/session';

interface RecordingEndDetail {
  channel_name: string;
  stream_id: string;
  recording_status: 'Recording End' | 'Recording End Failure';
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
}

export const handler = async (
  event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail>
): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN!;
  const channelArn = event.detail.channel_name;

  console.log('Recording End event received for channel:', channelArn);

  const docClient = getDocumentClient();

  // Find session by channel ARN
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
    console.warn('No session found for channel:', channelArn);
    return;
  }

  const session = scanResult.Items[0];
  const sessionId = session.sessionId;

  console.log('Found session:', sessionId, 'transitioning to ENDED');

  try {
    // Update session: ENDING -> ENDED
    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDED, 'endedAt');
    console.log('Session transitioned to ENDED:', sessionId);

    // Update recording metadata
    try {
      const recordingS3KeyPrefix = event.detail.recording_s3_key_prefix;
      const recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/master.m3u8`;
      const thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/thumb-0.jpg`;
      const finalStatus = event.detail.recording_status === 'Recording End' ? 'available' : 'failed';

      await updateRecordingMetadata(tableName, sessionId, {
        recordingDuration: event.detail.recording_duration_ms,
        recordingHlsUrl,
        thumbnailUrl,
        recordingStatus: finalStatus,
      });

      console.log('Recording metadata updated:', {
        sessionId,
        recordingDuration: event.detail.recording_duration_ms,
        recordingStatus: finalStatus,
      });
    } catch (metadataError: any) {
      console.error('Failed to update recording metadata (non-blocking):', metadataError.message);
      // Don't throw - metadata update is best-effort, don't block session cleanup
    }

    // Release pool resources
    if (session.claimedResources.channel) {
      await releasePoolResource(tableName, session.claimedResources.channel);
      console.log('Released channel resource:', session.claimedResources.channel);
    }

    if (session.claimedResources.chatRoom) {
      await releasePoolResource(tableName, session.claimedResources.chatRoom);
      console.log('Released chat room resource:', session.claimedResources.chatRoom);
    }

    console.log('Session cleanup complete:', sessionId);
  } catch (error: any) {
    console.error('Failed to clean up session:', error.message);
    // Don't throw - EventBridge will retry on error
  }
};
