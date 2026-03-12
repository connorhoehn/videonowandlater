/**
 * SQS-wrapped handler for IVS Recording End events
 * Handles both IVS Low-Latency (broadcast) and IVS RealTime Stage (hangout) recording-end events.
 * Transitions session from ENDING to ENDED and releases pool resources.
 * Receives EventBridge events via SQS queue for at-least-once delivery with DLQ support.
 */

import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand as UpdateCommandDirect, ScanCommand } from '@aws-sdk/lib-dynamodb';
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

export const tracer = new Tracer({ serviceName: 'vnl-pipeline' });

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'recording-ended' },
});

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

async function processEvent(
  event: EventBridgeEvent<string, Record<string, any>>,
  tracer: Tracer,
  docClient: DynamoDBDocumentClient,
  mediaConvertClient: MediaConvertClient
): Promise<void> {
  // Required environment variables
  const tableName = process.env.TABLE_NAME!;
  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN!;
  const mediaConvertRoleArn = process.env.MEDIACONVERT_ROLE_ARN!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const awsRegion = process.env.AWS_REGION!;
  const awsAccountId = process.env.AWS_ACCOUNT_ID!;

  const startMs = Date.now();

  // Recovery event path: dispatched by scan-stuck-sessions.ts for stalled pipeline sessions.
  // Recovery events use source 'custom.vnl' and carry session context in event.detail directly.
  if (event.detail?.recoveryAttempt === true) {
    const recoverySessionId = event.detail.sessionId as string | undefined;
    if (!recoverySessionId) {
      logger.error('Recovery event missing sessionId in detail');
      return;
    }
    tracer.putAnnotation('sessionId', recoverySessionId);
    logger.appendPersistentKeys({ sessionId: recoverySessionId });
    logger.info('Pipeline stage entered (recovery)', {
      recoveryAttemptCount: event.detail.recoveryAttemptCount,
    });

    // Re-submit MediaConvert using stored recordingHlsUrl from session.
    // The session already has recordingHlsUrl from the first recording-ended pass.
    // We fetch the session to get the full recordingHlsUrl and validate it.
    try {
      const getResult = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${recoverySessionId}`, SK: 'METADATA' },
      }));

      const recoverySession = getResult.Item;
      if (!recoverySession) {
        logger.warn('Recovery: session not found in DynamoDB', { sessionId: recoverySessionId });
        return;
      }

      const hlsUrl = recoverySession.recordingHlsUrl as string | undefined;
      if (!hlsUrl) {
        logger.warn('Recovery: session has no recordingHlsUrl, cannot resubmit MediaConvert', {
          sessionId: recoverySessionId,
        });
        return;
      }

      // Re-submit MediaConvert job using hlsUrl
      // Extract s3 bucket and key from CloudFront URL is unreliable;
      // derive from recordingS3Path if available, otherwise skip
      const s3Path = recoverySession.recordingS3Path as string | undefined;
      if (!s3Path) {
        logger.warn('Recovery: session has no recordingS3Path, cannot construct MediaConvert input', {
          sessionId: recoverySessionId,
        });
        return;
      }

      const hlsInputPath = `s3://${s3Path}/media/hls/master.m3u8`;
      const mp4OutputPath = `s3://${transcriptionBucket}/${recoverySessionId}/`;

      const result = await mediaConvertClient.send(new CreateJobCommand({
        Role: mediaConvertRoleArn,
        Queue: `arn:aws:mediaconvert:${awsRegion}:${awsAccountId}:queues/Default`,
        Settings: {
          Inputs: [{
            FileInput: hlsInputPath,
            AudioSelectors: { default: { DefaultSelection: 'DEFAULT' } },
          }],
          OutputGroups: [{
            Name: 'File Group',
            OutputGroupSettings: {
              Type: 'FILE_GROUP_SETTINGS',
              FileGroupSettings: { Destination: mp4OutputPath },
            },
            Outputs: [{
              NameModifier: 'recording',
              ContainerSettings: { Container: 'MP4' },
              VideoDescription: {
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: { Bitrate: 5000000, MaxBitrate: 5000000, RateControlMode: 'VBR', CodecProfile: 'MAIN' },
                },
              },
              AudioDescriptions: [{
                AudioSourceName: 'default',
                CodecSettings: {
                  Codec: 'AAC',
                  AacSettings: { Bitrate: 128000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48000 },
                },
              }],
            }],
          }],
        },
        Tags: { sessionId: recoverySessionId, phase: '19-transcription' },
        UserMetadata: { sessionId: recoverySessionId, phase: '19-transcription' },
      }));

      const jobId = result.Job?.Id;
      if (jobId) {
        await docClient.send(new UpdateCommandDirect({
          TableName: tableName,
          Key: { PK: `SESSION#${recoverySessionId}`, SK: 'METADATA' },
          UpdateExpression: 'SET mediaconvertJobId = :jobId, transcriptStatus = :status, #version = #version + :inc',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':jobId': jobId, ':status': 'processing', ':inc': 1 },
        }));
        logger.info('Recovery: MediaConvert job resubmitted', { jobId, sessionId: recoverySessionId });
      }
    } catch (recoveryError: any) {
      logger.error('Recovery: failed to resubmit MediaConvert job', {
        sessionId: recoverySessionId,
        error: recoveryError.message,
      });
    }

    logger.info('Pipeline stage completed (recovery)', {
      status: 'success',
      durationMs: Date.now() - startMs,
    });
    return;
  }

  const resourceArn = event.resources?.[0];
  if (!resourceArn) {
    logger.error('No resource ARN in event.resources');
    throw new Error('Invalid event: missing resource ARN');
  }

  logger.info('Recording End event received for resource:', { resourceArn });

  // Detect ARN type: Channel or Stage
  // ARN format: arn:aws:ivs:region:account:channel/id or arn:aws:ivs:region:account:stage/id
  const arnParts = resourceArn.split(':');
  const resourcePart = arnParts[arnParts.length - 1]; // "channel/id" or "stage/id"
  const resourceType = resourcePart.split('/')[0]; // "channel" or "stage"

  let session: Session | null = null;

  if (resourceType === 'channel') {
    logger.info('Detected Channel ARN, finding session by channel');

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
    logger.info('Detected Stage ARN, finding session by stage');
    session = await findSessionByStageArn(tableName, resourceArn);
  } else {
    logger.error('Unknown resource type in ARN:', { resourceArn });
    return;
  }

  if (!session) {
    logger.warn('No session found for resource:', { resourceArn });
    return;
  }

  const sessionId = session.sessionId;

  tracer.putAnnotation('sessionId', sessionId);
  logger.appendPersistentKeys({ sessionId });
  logger.info('Pipeline stage entered', { resourceArn, resourceType });

  logger.info('Found session, transitioning to ENDED', { sessionId });

  try {
    // Update session: ENDING -> ENDED
    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDED, 'endedAt');
    logger.info('Session transitioned to ENDED:', { sessionId });

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

      logger.info('Recording metadata updated:', {
        sessionId,
        recordingDuration: event.detail.recording_duration_ms,
        recordingStatus: finalStatus,
      });
    } catch (metadataError: any) {
      logger.error('Failed to update recording metadata (non-blocking):', { errorMessage: metadataError.message });
      // Don't throw - metadata update is best-effort, don't block session cleanup
    }

    // Compute and store reaction summary (best-effort, non-blocking)
    try {
      await computeAndStoreReactionSummary(tableName, sessionId);
    } catch (summaryError: any) {
      logger.error('Failed to compute reaction summary (non-blocking):', { errorMessage: summaryError.message });
      // Don't throw - summary computation is best-effort, don't block session cleanup
    }

    // Compute participant count for hangout sessions -- best-effort (PTCP-02)
    if (session.sessionType === SessionType.HANGOUT) {
      try {
        const participants = await getHangoutParticipants(tableName, sessionId);
        if (participants.length > 0) {
          await updateParticipantCount(tableName, sessionId, participants.length);
          logger.info('Participant count updated:', { sessionId, count: participants.length });
        }
      } catch (participantCountError: any) {
        logger.error('Failed to update participant count (non-blocking):', { errorMessage: participantCountError.message });
      }
    }

    // Critical: release pool resources even if MediaConvert throws
    try {
      // Submit MediaConvert job to convert HLS → MP4 for transcription
      // Throws on failure so SQS can retry via batchItemFailures
      if (finalStatus === 'available') {
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
        await docClient.send(new UpdateCommandDirect({
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

        logger.info('MediaConvert job submitted:', {
          jobId,
          jobName,
          sessionId,
        });
      }
    } finally {
      // Pool resource release always executes, even if MediaConvert throws
      if (session.claimedResources?.channel) {
        await releasePoolResource(tableName, session.claimedResources.channel);
        logger.info('Released channel resource:', { channel: session.claimedResources.channel });
      }

      if (session.claimedResources?.stage) {
        await releasePoolResource(tableName, session.claimedResources.stage);
        logger.info('Released stage resource:', { stage: session.claimedResources.stage });
      }

      if (session.claimedResources?.chatRoom) {
        await releasePoolResource(tableName, session.claimedResources.chatRoom);
        logger.info('Released chat room resource:', { chatRoom: session.claimedResources.chatRoom });
      }
    }

    logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
    logger.info('Session cleanup complete:', { sessionId });
  } catch (error: any) {
    logger.error('Failed to clean up session:', { errorMessage: error.message });
    logger.error('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs, errorMessage: error.message });
    throw error; // Let SQS outer handler catch this and report batchItemFailure
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];
  const parentSegment = tracer.getSegment();

  // Wrap SDK clients with X-Ray tracing on each invocation.
  // This ensures per-request tracing and is compatible with the test contract
  // (beforeEach clears mock state, so clients must be re-wrapped per invocation).
  const dynamoBaseClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
  const docClient = DynamoDBDocumentClient.from(dynamoBaseClient, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const mediaConvertClient = tracer.captureAWSv3Client(new MediaConvertClient({
    endpoint: process.env.MEDIACONVERT_ENDPOINT,
  }));

  for (const record of event.Records) {
    let subsegment: Subsegment | undefined;
    try {
      const ebEvent = JSON.parse(record.body) as EventBridgeEvent<string, Record<string, any>>;
      subsegment = parentSegment?.addNewSubsegment('## processRecord') as Subsegment | undefined;
      if (subsegment) tracer.setSegment(subsegment);

      tracer.putAnnotation('pipelineStage', 'recording-ended');

      await processEvent(ebEvent, tracer, docClient, mediaConvertClient);
    } catch (err: any) {
      tracer.addErrorAsMetadata(err as Error);
      logger.error('Failed to process SQS record', {
        messageId: record.messageId,
        error: err.message,
      });
      failures.push({ itemIdentifier: record.messageId });
    } finally {
      subsegment?.close();
      if (parentSegment) tracer.setSegment(parentSegment);
    }
  }

  return { batchItemFailures: failures };
};
