/**
 * EventBridge handler for IVS Recording End events
 * Handles both IVS Low-Latency (broadcast) and IVS RealTime Stage (hangout) recording-end events.
 * Transitions session from ENDING to ENDED and releases pool resources.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getDocumentClient } from '../lib/dynamodb-client';
import {
  updateSessionStatus,
  updateRecordingMetadata,
  findSessionByStageArn,
  computeAndStoreReactionSummary,
  getHangoutParticipants,
  updateParticipantCount,
} from '../repositories/session-repository';
import { releasePoolResource } from '../repositories/resource-pool-repository';
import { SessionStatus, SessionType } from '../domain/session';
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
  // Required environment variables
  const tableName = process.env.TABLE_NAME!;
  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN!;
  const mediaConvertRoleArn = process.env.MEDIACONVERT_ROLE_ARN!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const awsRegion = process.env.AWS_REGION!;
  const awsAccountId = process.env.AWS_ACCOUNT_ID!;
  const eventBusName = process.env.EVENT_BUS_NAME!;

  const resourceArn = event.resources?.[0];
  if (!resourceArn) {
    console.error('No resource ARN in event.resources');
    throw new Error('Invalid event: missing resource ARN');
  }

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

    // Find session by channel ARN — filter to ENDING only to avoid matching
    // previously-ended sessions that used the same pooled channel
    const scanResult = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :session) AND claimedResources.#channel = :channelArn AND #status = :ending',
      ExpressionAttributeNames: {
        '#channel': 'channel',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':session': 'SESSION#',
        ':channelArn': resourceArn,
        ':ending': 'ending',
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
    let finalStatus: 'available' | 'failed' = 'failed';
    let recordingS3KeyPrefix: string = '';
    let recordingsBucket: string = '';
    let recordingDuration: number = 0;

    try {
      // Validate required event fields
      recordingS3KeyPrefix = event.detail.recording_s3_key_prefix;
      recordingsBucket = event.detail.recording_s3_bucket_name;
      recordingDuration = event.detail.recording_duration_ms;

      if (!recordingS3KeyPrefix || !recordingsBucket || typeof recordingDuration !== 'number') {
        throw new Error('Invalid event detail: missing required recording metadata');
      }

      // Validate S3 path doesn't contain suspicious patterns (basic injection prevention)
      if (recordingS3KeyPrefix.includes('..') || recordingS3KeyPrefix.startsWith('/')) {
        throw new Error('Invalid S3 key prefix format');
      }

      let recordingHlsUrl: string;
      let thumbnailUrl: string;

      if (resourceType === 'channel') {
        // IVS Low-Latency broadcast recording structure
        recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/hls/master.m3u8`;
        thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/thumbnails/thumb0.jpg`;
      } else {
        // IVS RealTime Stage participant recording structure
        recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/hls/multivariant.m3u8`;
        thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/latest_thumbnail/high/thumb.jpg`;
      }

      // recording_status field only exists on broadcast events; Stage "Recording End" events are always successful
      finalStatus = event.detail.recording_status === 'Recording End Failure'
        ? 'failed'
        : 'available';

      await updateRecordingMetadata(tableName, sessionId, {
        recordingDuration,
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

    // Compute and store reaction summary (best-effort, non-blocking)
    try {
      await computeAndStoreReactionSummary(tableName, sessionId);
    } catch (summaryError: any) {
      console.error('Failed to compute reaction summary (non-blocking):', summaryError.message);
      // Don't throw - summary computation is best-effort, don't block session cleanup
    }

    // Compute participant count for hangout sessions -- best-effort (PTCP-02)
    if (session.sessionType === SessionType.HANGOUT) {
      try {
        const participants = await getHangoutParticipants(tableName, sessionId);
        if (participants.length > 0) {
          await updateParticipantCount(tableName, sessionId, participants.length);
          console.log('Participant count updated:', { sessionId, count: participants.length });
        }
      } catch (participantCountError: any) {
        console.error('Failed to update participant count (non-blocking):', participantCountError.message);
      }
    }

    // Submit MediaConvert job to convert HLS → MP4 for transcription (best-effort, non-blocking)
    if (finalStatus === 'available') {
      try {
        const mediaConvertClient = new MediaConvertClient({ region: awsRegion });
        const epochMs = Date.now();
        const jobName = `vnl-${sessionId}-${epochMs}`;

        // Build HLS input path (master.m3u8 location from IVS recording structure)
        const hlsInputPath = `s3://${recordingsBucket}/${recordingS3KeyPrefix}/media/hls/master.m3u8`;
        const mp4OutputPath = `s3://${transcriptionBucket}/${sessionId}/`;

        // Validate constructed paths
        if (!hlsInputPath.match(/^s3:\/\/[\w\-\.]+\/[\w\-\.\/]+\.m3u8$/)) {
          throw new Error(`Invalid HLS input path format: ${hlsInputPath}`);
        }
        if (!mp4OutputPath.match(/^s3:\/\/[\w\-\.]+\/[\w\-\.\/]+\/$/)) {
          throw new Error(`Invalid MP4 output path format: ${mp4OutputPath}`);
        }

        const createJobCommand = new CreateJobCommand({
          Role: mediaConvertRoleArn,
          Queue: `arn:aws:mediaconvert:${awsRegion}:${awsAccountId}:queues/Default`,
          Settings: {
            Inputs: [
              {
                FileInput: hlsInputPath,
                AudioSelectors: {
                  default: {
                    DefaultSelection: 'DEFAULT',
                  },
                },
              },
            ],
            OutputGroups: [
              {
                Name: 'File Group',
                OutputGroupSettings: {
                  Type: 'FILE_GROUP_SETTINGS',
                  FileGroupSettings: {
                    Destination: mp4OutputPath,
                  },
                },
                Outputs: [
                  {
                    NameModifier: 'recording',
                    ContainerSettings: {
                      Container: 'MP4',
                    },
                    VideoDescription: {
                      CodecSettings: {
                        Codec: 'H_264',
                        H264Settings: {
                          Bitrate: 5000000,
                          MaxBitrate: 5000000,
                          RateControlMode: 'VBR',
                          CodecProfile: 'MAIN',
                        },
                      },
                    },
                    AudioDescriptions: [
                      {
                        AudioSourceName: 'default',
                        CodecSettings: {
                          Codec: 'AAC',
                          AacSettings: {
                            Bitrate: 128000,
                            CodingMode: 'CODING_MODE_2_0',
                            SampleRate: 48000,
                          },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          Tags: {
            sessionId,
            phase: '19-transcription',
          },
          UserMetadata: {
            sessionId,
            phase: '19-transcription',
          },
        });

        const result = await mediaConvertClient.send(createJobCommand);
        const jobId = result.Job?.Id;

        if (!jobId) {
          throw new Error('MediaConvert did not return a job ID');
        }

        // Store MediaConvert job ID in session for tracking
        const docClient = getDocumentClient();
        await docClient.send(new (await import('@aws-sdk/lib-dynamodb')).UpdateCommand({
          TableName: tableName,
          Key: {
            PK: `SESSION#${sessionId}`,
            SK: 'METADATA',
          },
          UpdateExpression: 'SET mediaconvertJobId = :jobId, transcriptStatus = :status, #version = #version + :inc',
          ExpressionAttributeNames: {
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':jobId': jobId,
            ':status': 'processing',
            ':inc': 1,
          },
        }));

        console.log('MediaConvert job submitted:', {
          jobId,
          jobName,
          sessionId,
        });

        // Immediately publish "Upload Recording Available" event to trigger transcription
        // This bypasses waiting for MediaConvert to emit a completion event, which has
        // event detail structure issues. We'll use the MP4 output path that MediaConvert creates.
        const mp4FileUri = `s3://${transcriptionBucket}/${sessionId}/masterrecording.mp4`;
        try {
          const eventBridgeClient = new EventBridgeClient({ region: awsRegion });
          await eventBridgeClient.send(
            new PutEventsCommand({
              Entries: [
                {
                  Source: 'vnl.mediaconvert',
                  DetailType: 'Upload Recording Available',
                  Detail: JSON.stringify({
                    sessionId,
                    recordingHlsUrl: mp4FileUri, // MP4 file output from MediaConvert
                  }),
                  EventBusName: eventBusName,
                },
              ],
            })
          );
          console.log('Transcription pipeline triggered via EventBridge:', {
            sessionId,
            recordingUrl: mp4FileUri,
          });
        } catch (publishError: any) {
          console.error('Failed to publish transcription trigger event (non-blocking):', {
            sessionId,
            error: publishError.message,
          });
          // Don't throw - transcription can still proceed if triggered via MediaConvert complete
        }
      } catch (mediaConvertError: any) {
        console.error('Failed to submit MediaConvert job (non-blocking):', {
          sessionId,
          error: mediaConvertError.message,
          code: mediaConvertError.Code || mediaConvertError.$metadata?.httpStatusCode,
          type: mediaConvertError.name,
        });
        // Do NOT throw — transcription is best-effort, don't block session cleanup
      }
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
