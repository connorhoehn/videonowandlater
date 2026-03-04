/**
 * EventBridge handler for IVS Recording End events
 * Handles both IVS Low-Latency (broadcast) and IVS RealTime Stage (hangout) recording-end events.
 * Transitions session from ENDING to ENDED and releases pool resources.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { getDocumentClient } from '../lib/dynamodb-client';
import {
  updateSessionStatus,
  updateRecordingMetadata,
  findSessionByStageArn
} from '../repositories/session-repository';
import { releasePoolResource } from '../repositories/resource-pool-repository';
import { SessionStatus } from '../domain/session';
import type { Session } from '../domain/session';

interface BroadcastRecordingEndDetail {
  channel_name: string;          // Human-readable channel name (NOT the ARN)
  stream_id: string;
  recording_status: 'Recording End' | 'Recording End Failure';
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
}

interface StageParticipantRecordingEndDetail {
  session_id: string;
  event_name: 'Recording End';
  participant_id: string;
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
}

export const handler = async (
  event: EventBridgeEvent<string, Record<string, any>>
): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN!;
  const resourceArn = event.resources[0];

  console.log('Recording End event received for resource:', resourceArn);

  // Detect ARN type: Channel or Stage
  // ARN format: arn:aws:ivs:region:account:channel/id or arn:aws:ivs:region:account:stage/id
  const arnParts = resourceArn.split(':');
  const resourcePart = arnParts[arnParts.length - 1]; // "channel/id" or "stage/id"
  const resourceType = resourcePart.split('/')[0]; // "channel" or "stage"

  let session: Session | null = null;

  if (resourceType === 'channel') {
    console.log('Detected Channel ARN, finding session by channel');
    const docClient = getDocumentClient();
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');

    // Find session by channel ARN (existing logic)
    const scanResult = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :session) AND claimedResources.#channel = :channelArn',
      ExpressionAttributeNames: {
        '#channel': 'channel',
      },
      ExpressionAttributeValues: {
        ':session': 'SESSION#',
        ':channelArn': resourceArn,
      },
    }));

    if (scanResult.Items && scanResult.Items.length > 0) {
      const item = scanResult.Items[0];
      const { PK, SK, GSI1PK, GSI1SK, entityType, ...sessionData } = item;
      session = sessionData as Session;
    }
  } else if (resourceType === 'stage') {
    console.log('Detected Stage ARN, finding session by stage');
    session = await findSessionByStageArn(tableName, resourceArn);
  } else {
    console.error('Unknown resource type in ARN:', resourceArn);
    return;
  }

  if (!session) {
    console.warn('No session found for resource:', resourceArn);
    return;
  }

  const sessionId = session.sessionId;

  console.log('Found session:', sessionId, 'transitioning to ENDED');

  try {
    // Update session: ENDING -> ENDED
    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDED, 'endedAt');
    console.log('Session transitioned to ENDED:', sessionId);

    // Update recording metadata
    try {
      const recordingS3KeyPrefix = event.detail.recording_s3_key_prefix;
      let recordingHlsUrl: string;
      let thumbnailUrl: string;

      if (resourceType === 'channel') {
        // IVS Low-Latency broadcast recording structure
        recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/master.m3u8`;
        thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/thumb-0.jpg`;
      } else {
        // IVS RealTime Stage participant recording structure
        recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/hls/multivariant.m3u8`;
        thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/latest_thumbnail/high/thumb.jpg`;
      }

      // recording_status field only exists on broadcast events; Stage "Recording End" events are always successful
      const finalStatus = event.detail.recording_status === 'Recording End Failure'
        ? 'failed'
        : 'available';

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

    // Release pool resources (Channel or Stage)
    if (session.claimedResources?.channel) {
      await releasePoolResource(tableName, session.claimedResources.channel);
      console.log('Released channel resource:', session.claimedResources.channel);
    }

    if (session.claimedResources?.stage) {
      await releasePoolResource(tableName, session.claimedResources.stage);
      console.log('Released stage resource:', session.claimedResources.stage);
    }

    if (session.claimedResources?.chatRoom) {
      await releasePoolResource(tableName, session.claimedResources.chatRoom);
      console.log('Released chat room resource:', session.claimedResources.chatRoom);
    }

    console.log('Session cleanup complete:', sessionId);
  } catch (error: any) {
    console.error('Failed to clean up session:', error.message);
    // Don't throw - EventBridge will retry on error
  }
};
