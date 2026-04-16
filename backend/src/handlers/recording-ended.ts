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
import { DynamoDBDocumentClient, GetCommand, UpdateCommand as UpdateCommandDirect } from '@aws-sdk/lib-dynamodb';
import { RecordingEndedDetailSchema, type RecordingEndedDetail } from './schemas/recording-ended.schema';
import {
  updateSessionStatus,
  updateRecordingMetadata,
  findSessionByChannelArn,
  findSessionByStageArn,
  computeAndStoreReactionSummary,
  getHangoutParticipants,
  updateParticipantCount,
  updateParticipantRecording,
  getParticipantsWithRecordings,
} from '../repositories/session-repository';
import { releasePoolResource } from '../repositories/resource-pool-repository';
import { SessionStatus, SessionType } from '../domain/session';
import type { Session } from '../domain/session';
import { calculateIvsRealtimeCost, calculateIvsLowLatencyCost, calculateMediaConvertCost, CostService, PRICING_RATES } from '../domain/cost';
import { writeCostLineItem, upsertCostSummary } from '../repositories/cost-repository';
import { emitCostMetric } from '../lib/cost-metrics';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';
import { v4 as uuidv4 } from 'uuid';

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

// Type guard for broadcast/hangout events (non-recovery)
function isBroadcastOrHangoutEvent(detail: any): detail is (BroadcastRecordingEndDetail | StageParticipantRecordingEndDetail) {
  return 'recording_s3_bucket_name' in detail && 'recording_duration_ms' in detail;
}

async function processEvent(
  event: EventBridgeEvent<string, RecordingEndedDetail>,
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
  if ('recoveryAttempt' in event.detail && event.detail.recoveryAttempt === true) {
    const recoverySessionId = (event.detail as any).sessionId as string | undefined;
    if (!recoverySessionId) {
      logger.error('Recovery event missing sessionId in detail');
      return;
    }
    tracer.putAnnotation('sessionId', recoverySessionId);
    logger.appendPersistentKeys({ sessionId: recoverySessionId });
    logger.info('Pipeline stage entered (recovery)', {
      recoveryAttemptCount: (event.detail as any).recoveryAttemptCount,
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

    // Query GSI3 for session by channel ARN, filter to ENDING status
    // to avoid matching previously-ended sessions that used the same pooled channel
    session = await findSessionByChannelArn(tableName, resourceArn, SessionStatus.ENDING);
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

  logger.info('Found session, processing recording event', { sessionId });

  try {
    // Validate required event fields
    if (!isBroadcastOrHangoutEvent(event.detail)) {
      throw new Error('Invalid event detail: not a broadcast or hangout event');
    }

    const recordingS3KeyPrefix = event.detail.recording_s3_key_prefix;
    const recordingsBucket = event.detail.recording_s3_bucket_name;
    let recordingDuration = event.detail.recording_duration_ms;

    if (!recordingS3KeyPrefix || !recordingsBucket || typeof recordingDuration !== 'number') {
      throw new Error('Invalid event detail: missing required recording metadata');
    }

    // Validate recording duration (0 to 24 hours)
    const MAX_RECORDING_DURATION_MS = 24 * 60 * 60 * 1000;
    if (recordingDuration < 0 || recordingDuration > MAX_RECORDING_DURATION_MS) {
      logger.warn('Recording duration out of expected range, clamping', { sessionId, rawDuration: recordingDuration });
      recordingDuration = Math.max(0, Math.min(recordingDuration, MAX_RECORDING_DURATION_MS));
    }

    if (recordingS3KeyPrefix.includes('..') || recordingS3KeyPrefix.startsWith('/')) {
      throw new Error('Invalid S3 key prefix format');
    }

    const detail = event.detail as any;
    const finalStatus: 'available' | 'failed' = detail.recording_status === 'Recording End Failure' ? 'failed' : 'available';

    // ─── HANGOUT: per-participant recording collection ───────────────────
    if (session.sessionType === SessionType.HANGOUT) {
      const stageDetail = event.detail as StageParticipantRecordingEndDetail;
      const participantIvsId = stageDetail.participant_id;
      const recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/hls/multivariant.m3u8`;
      const thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/latest_thumbnail/high/thumb.jpg`;

      logger.info('Hangout participant recording ended', { sessionId, participantIvsId, recordingStatus: finalStatus });

      // Store this participant's recording metadata
      await updateParticipantRecording(tableName, sessionId, participantIvsId, {
        recordingS3KeyPrefix,
        recordingHlsUrl,
        recordingDuration,
        recordingStatus: finalStatus,
      });

      // Atomically increment recordingsReceived counter to avoid race conditions
      // when multiple Recording End events arrive simultaneously
      const allParticipants = await getParticipantsWithRecordings(tableName, sessionId);
      const totalParticipants = allParticipants.length;

      const counterResult = await docClient.send(new UpdateCommandDirect({
        TableName: tableName,
        Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        UpdateExpression: 'SET recordingsReceived = if_not_exists(recordingsReceived, :zero) + :inc',
        ExpressionAttributeValues: { ':zero': 0, ':inc': 1 },
        ReturnValues: 'ALL_NEW',
      }));
      const recordingsReceived = (counterResult.Attributes?.recordingsReceived as number) ?? 0;

      logger.info('Participant recording progress (atomic)', {
        sessionId,
        recordingsReceived,
        totalParticipants,
      });

      if (recordingsReceived < totalParticipants) {
        logger.info('Waiting for remaining participant recordings', { sessionId });
        return;
      }

      // All participants recorded — this invocation won the race
      logger.info('All participant recordings received, processing hangout', { sessionId });
      const availableRecordings = allParticipants.filter(p => p.recordingStatus === 'available');

      try {
        await emitSessionEvent(tableName, {
          eventId: uuidv4(), sessionId, eventType: SessionEventType.RECORDING_ENDED,
          timestamp: new Date().toISOString(), actorId: 'SYSTEM',
          actorType: 'system', details: { recordingStatus: finalStatus, participantCount: totalParticipants },
        });
      } catch { /* non-blocking */ }

      // Update participant count
      await updateParticipantCount(tableName, sessionId, totalParticipants);

      // Use the first available participant's recording for session-level metadata (feed display)
      const firstAvailable = availableRecordings[0];
      if (firstAvailable) {
        await updateRecordingMetadata(tableName, sessionId, {
          recordingDuration: Math.max(...availableRecordings.map(p => p.recordingDuration || 0)),
          recordingHlsUrl: firstAvailable.recordingHlsUrl!,
          thumbnailUrl,
          recordingStatus: 'available',
        });
      }

      // Record IVS Realtime cost (non-blocking)
      try {
        const maxDuration = Math.max(...availableRecordings.map(p => p.recordingDuration || 0));
        const participantMinutes = (maxDuration / 60000) * totalParticipants;
        const costUsd = calculateIvsRealtimeCost(participantMinutes);
        await writeCostLineItem(tableName, {
          sessionId, service: CostService.IVS_REALTIME, costUsd, quantity: participantMinutes, unit: 'participant-minutes',
          rateApplied: PRICING_RATES.IVS_REALTIME, sessionType: session.sessionType, userId: session.userId,
          createdAt: new Date().toISOString(),
        });
        await upsertCostSummary(tableName, sessionId, CostService.IVS_REALTIME, costUsd, session.sessionType, session.userId);
        logger.info('Cost recorded', { service: 'IVS_REALTIME', costUsd, sessionId });
        await emitCostMetric('IVS_REALTIME', costUsd, session.sessionType, sessionId);
      } catch (costError: any) {
        logger.warn('Failed to record cost (non-blocking)', { error: costError.message });
      }

      // Compute reaction summary (best-effort)
      try {
        await computeAndStoreReactionSummary(tableName, sessionId);
      } catch (summaryError: any) {
        logger.error('Failed to compute reaction summary (non-blocking):', { errorMessage: summaryError.message });
      }

      // Submit a MediaConvert job per participant with available recordings
      try {
        for (const participant of availableRecordings) {
          const userId = participant.userId;
          const hlsInputPath = `s3://${recordingsBucket}/${participant.recordingS3KeyPrefix}/media/hls/multivariant.m3u8`;
          const mp4OutputPath = `s3://${transcriptionBucket}/${sessionId}/participants/${userId}/`;

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
            Tags: { sessionId, phase: '19-transcription', userId },
            UserMetadata: { sessionId, phase: '19-transcription', userId },
          }));

          logger.info('MediaConvert job submitted for participant', {
            sessionId, userId, jobId: result.Job?.Id,
          });

          // Record MediaConvert cost per participant (non-blocking)
          try {
            const mcMinutes = (participant.recordingDuration || 0) / 60000;
            const mcCostUsd = calculateMediaConvertCost(mcMinutes);
            await writeCostLineItem(tableName, {
              sessionId, service: CostService.MEDIACONVERT, costUsd: mcCostUsd, quantity: mcMinutes, unit: 'minutes',
              rateApplied: PRICING_RATES.MEDIACONVERT, sessionType: session.sessionType, userId: session.userId,
              createdAt: new Date().toISOString(),
            });
            await upsertCostSummary(tableName, sessionId, CostService.MEDIACONVERT, mcCostUsd, session.sessionType, session.userId);
            logger.info('Cost recorded', { service: 'MEDIACONVERT', costUsd: mcCostUsd, sessionId, participantUserId: userId });
            await emitCostMetric('MEDIACONVERT', mcCostUsd, session.sessionType, sessionId);
          } catch (costError: any) {
            logger.warn('Failed to record cost (non-blocking)', { error: costError.message });
          }
        }

        // Mark session as processing transcription
        await docClient.send(new UpdateCommandDirect({
          TableName: tableName,
          Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
          UpdateExpression: 'SET transcriptStatus = :status, pendingTranscripts = :count, #version = #version + :inc',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: {
            ':status': 'processing',
            ':count': availableRecordings.length,
            ':inc': 1,
          },
        }));
      } finally {
        // Release pool resources after all MediaConvert jobs submitted
        if (session.claimedResources?.stage) {
          await releasePoolResource(tableName, session.claimedResources.stage);
          logger.info('Released stage resource:', { stage: session.claimedResources.stage });
        }
        if (session.claimedResources?.chatRoom) {
          await releasePoolResource(tableName, session.claimedResources.chatRoom);
          logger.info('Released chat room resource:', { chatRoom: session.claimedResources.chatRoom });
        }
      }

      logger.info('Pipeline stage completed (hangout)', { status: 'success', durationMs: Date.now() - startMs });
      return;
    }

    // ─── BROADCAST: existing single-recording flow ──────────────────────
    try {
      await emitSessionEvent(tableName, {
        eventId: uuidv4(), sessionId, eventType: SessionEventType.RECORDING_ENDED,
        timestamp: new Date().toISOString(), actorId: 'SYSTEM',
        actorType: 'system', details: { recordingStatus: finalStatus },
      });
    } catch { /* non-blocking */ }

    // Update session: ENDING -> ENDED
    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDED, 'endedAt');
    logger.info('Session transitioned to ENDED:', { sessionId });

    // Update recording metadata
    try {
      const recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/hls/master.m3u8`;
      const thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/thumbnails/thumb0.jpg`;

      await updateRecordingMetadata(tableName, sessionId, {
        recordingDuration,
        recordingHlsUrl,
        thumbnailUrl,
        recordingStatus: finalStatus,
      });

      logger.info('Recording metadata updated:', { sessionId, recordingDuration, recordingStatus: finalStatus });

      // Record IVS Low-Latency cost (non-blocking)
      try {
        const hours = recordingDuration / 3600000;
        const costUsd = calculateIvsLowLatencyCost(hours);
        await writeCostLineItem(tableName, {
          sessionId, service: CostService.IVS_LOW_LATENCY, costUsd, quantity: hours, unit: 'hours',
          rateApplied: PRICING_RATES.IVS_LOW_LATENCY, sessionType: session.sessionType, userId: session.userId,
          createdAt: new Date().toISOString(),
        });
        await upsertCostSummary(tableName, sessionId, CostService.IVS_LOW_LATENCY, costUsd, session.sessionType, session.userId);
        logger.info('Cost recorded', { service: 'IVS_LOW_LATENCY', costUsd, sessionId });
        await emitCostMetric('IVS_LOW_LATENCY', costUsd, session.sessionType, sessionId);
      } catch (costError: any) {
        logger.warn('Failed to record cost (non-blocking)', { error: costError.message });
      }
    } catch (metadataError: any) {
      logger.error('Failed to update recording metadata (non-blocking):', { errorMessage: metadataError.message });
    }

    // Compute and store reaction summary (best-effort, non-blocking)
    try {
      await computeAndStoreReactionSummary(tableName, sessionId);
    } catch (summaryError: any) {
      logger.error('Failed to compute reaction summary (non-blocking):', { errorMessage: summaryError.message });
    }

    // Submit MediaConvert job for broadcast
    try {
      if (finalStatus === 'available') {
        const hlsInputPath = `s3://${recordingsBucket}/${recordingS3KeyPrefix}/media/hls/master.m3u8`;
        const mp4OutputPath = `s3://${transcriptionBucket}/${sessionId}/`;

        const result = await mediaConvertClient.send(new CreateJobCommand({
          Role: mediaConvertRoleArn,
          Queue: `arn:aws:mediaconvert:${awsRegion}:${awsAccountId}:queues/Default`,
          Settings: {
            Inputs: [{
              FileInput: hlsInputPath,
              AudioSelectors: { default: { DefaultSelection: 'DEFAULT' } },
            }],
            OutputGroups: [
              {
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
              },
              {
                Name: 'Thumbnails',
                OutputGroupSettings: {
                  Type: 'FILE_GROUP_SETTINGS',
                  FileGroupSettings: { Destination: `s3://${transcriptionBucket}/${sessionId}/thumbnails/` },
                },
                Outputs: [{
                  ContainerSettings: { Container: 'RAW' },
                  VideoDescription: {
                    Width: 640, Height: 360, ScalingBehavior: 'DEFAULT',
                    CodecSettings: {
                      Codec: 'FRAME_CAPTURE',
                      FrameCaptureSettings: { FramerateNumerator: 1, FramerateDenominator: 5, MaxCaptures: 500, Quality: 80 },
                    },
                  },
                  Extension: 'jpg',
                  NameModifier: '-thumb',
                }],
              },
            ],
          },
          Tags: { sessionId, phase: '19-transcription' },
          UserMetadata: { sessionId, phase: '19-transcription' },
        }));

        const jobId = result.Job?.Id;
        if (!jobId) throw new Error('MediaConvert did not return a job ID');

        await docClient.send(new UpdateCommandDirect({
          TableName: tableName,
          Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
          UpdateExpression: 'SET mediaconvertJobId = :jobId, transcriptStatus = :status, #version = #version + :inc',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues: { ':jobId': jobId, ':status': 'processing', ':inc': 1 },
        }));

        logger.info('MediaConvert job submitted:', { jobId, sessionId });

        try {
          await emitSessionEvent(tableName, {
            eventId: uuidv4(), sessionId, eventType: SessionEventType.MEDIACONVERT_SUBMITTED,
            timestamp: new Date().toISOString(), actorId: 'SYSTEM',
            actorType: 'system', details: { jobId },
          });
        } catch { /* non-blocking */ }

        // Record MediaConvert cost (non-blocking)
        try {
          const mcMinutes = recordingDuration / 60000;
          const mcCostUsd = calculateMediaConvertCost(mcMinutes);
          await writeCostLineItem(tableName, {
            sessionId, service: CostService.MEDIACONVERT, costUsd: mcCostUsd, quantity: mcMinutes, unit: 'minutes',
            rateApplied: PRICING_RATES.MEDIACONVERT, sessionType: session.sessionType, userId: session.userId,
            createdAt: new Date().toISOString(),
          });
          await upsertCostSummary(tableName, sessionId, CostService.MEDIACONVERT, mcCostUsd, session.sessionType, session.userId);
          logger.info('Cost recorded', { service: 'MEDIACONVERT', costUsd: mcCostUsd, sessionId });
          await emitCostMetric('MEDIACONVERT', mcCostUsd, session.sessionType, sessionId);
        } catch (costError: any) {
          logger.warn('Failed to record cost (non-blocking)', { error: costError.message });
        }
      }
    } finally {
      // Pool resource release always executes
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
  } catch (error: any) {
    logger.error('Failed to process recording event:', { errorMessage: error.message });
    logger.error('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs, errorMessage: error.message });
    throw error;
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

      // Validate EventBridge envelope
      if (!ebEvent.detail) {
        logger.error('Missing EventBridge detail field', { messageId: record.messageId });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate detail schema
      const detailResult = RecordingEndedDetailSchema.safeParse(ebEvent.detail);
      if (!detailResult.success) {
        const fieldErrors = detailResult.error.flatten().fieldErrors;
        logger.error('Event validation failed', {
          messageId: record.messageId,
          handler: 'recording-ended',
          validationErrors: Object.entries(fieldErrors).map(([field, messages]) => ({
            field,
            issues: messages,
          })),
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      await processEvent(ebEvent as EventBridgeEvent<string, RecordingEndedDetail>, tracer, docClient, mediaConvertClient);
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
