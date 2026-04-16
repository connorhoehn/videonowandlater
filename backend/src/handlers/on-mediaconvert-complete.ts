/**
 * SQS-wrapped Lambda handler for EventBridge MediaConvert job completion events
 * Updates session recording metadata when MediaConvert encoding completes
 * Publishes an explicit EventBridge event to trigger Phase 19 transcription pipeline
 * Receives EventBridge events via SQS queue for at-least-once delivery with DLQ support
 */

import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { getSessionById, updateSessionRecording, updateHighlightReel } from '../repositories/session-repository';
import { SessionStatus } from '../domain/session';
import { MediaConvertCompleteDetailSchema, type MediaConvertCompleteDetail } from './schemas/on-mediaconvert-complete.schema';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';
import { v4 as uuidv4 } from 'uuid';

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'on-mediaconvert-complete' },
});
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

// MediaConvertCompleteDetail is imported from schema

async function processEvent(
  event: EventBridgeEvent<string, MediaConvertCompleteDetail>
): Promise<void> {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment('## processEvent') as Subsegment | undefined;
  if (subsegment) tracer.setSegment(subsegment);

  try {
    tracer.putAnnotation('pipelineStage', 'on-mediaconvert-complete');

    const tableName = process.env.TABLE_NAME!;
    const bucket = process.env.RECORDINGS_BUCKET!;
    const eventBusName = process.env.EVENT_BUS_NAME!;
    const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;

    const detail = event.detail;
    const { jobName, jobId, status } = detail;

    logger.info('MediaConvert job state change', { jobName, jobId, status });

    // Extract sessionId from userMetadata (preferred) or parse from jobName (legacy)
    let sessionId: string | undefined = detail.userMetadata?.sessionId;
    if (!sessionId && jobName) {
      const jobNameMatch = jobName.match(/^vnl-([a-z0-9-]+)-\d+$/);
      if (jobNameMatch) {
        sessionId = jobNameMatch[1];
      }
    }
    if (!sessionId) {
      logger.error('Could not extract sessionId from event', { jobName, jobId, userMetadata: detail.userMetadata });
      return;
    }

    tracer.putAnnotation('sessionId', sessionId);

    // Get session
    const session = await getSessionById(tableName, sessionId);
    if (!session) {
      logger.error('Session not found', { sessionId });
      return;
    }

    // Check if this is a highlight-reel MediaConvert job
    const phase = detail.userMetadata?.phase;

    if (phase === 'highlight-reel') {
      if (status === 'COMPLETE') {
        // Extract output file paths for landscape and vertical highlight reels
        let highlightReelUrl: string | undefined;
        let highlightReelVerticalUrl: string | undefined;

        if (detail.outputGroupDetails && cloudFrontDomain) {
          for (const group of detail.outputGroupDetails) {
            const outputDetails = group.outputDetails;
            if (!outputDetails || outputDetails.length === 0) continue;
            const filePaths = outputDetails[0].outputFilePaths;
            if (!filePaths || filePaths.length === 0) continue;

            const filePath = filePaths[0];
            // Convert S3 path to CloudFront URL
            const s3Key = filePath.replace(/^s3:\/\/[^/]+\//, '');

            if (filePath.includes('-landscape')) {
              highlightReelUrl = `https://${cloudFrontDomain}/${s3Key}`;
            } else if (filePath.includes('-vertical')) {
              highlightReelVerticalUrl = `https://${cloudFrontDomain}/${s3Key}`;
            }
          }
        }

        await updateHighlightReel(tableName, sessionId, {
          highlightReelUrl,
          highlightReelVerticalUrl,
          highlightReelStatus: 'available',
        });

        logger.info('Highlight reel completed', {
          sessionId,
          highlightReelUrl,
          highlightReelVerticalUrl,
        });
      } else if (status === 'ERROR' || status === 'CANCELED') {
        await updateHighlightReel(tableName, sessionId, {
          highlightReelStatus: 'failed',
        });
        logger.error('Highlight reel MediaConvert job failed', { jobName, jobId, status });
      }
      return; // Early return for highlight-reel jobs
    }

    if (status === 'COMPLETE') {
      // MediaConvert job succeeded — update convertStatus only
      // Do NOT overwrite recordingHlsUrl — recording-ended already set the CloudFront URL
      logger.info('MediaConvert complete, updating convertStatus', { sessionId });

      try {
        await emitSessionEvent(tableName, {
          eventId: uuidv4(), sessionId, eventType: SessionEventType.MEDIACONVERT_COMPLETED,
          timestamp: new Date().toISOString(), actorId: 'SYSTEM',
          actorType: 'system', details: { jobId, status },
        });
      } catch { /* non-blocking */ }

      await updateSessionRecording(tableName, sessionId, {
        convertStatus: 'available',
      });

      logger.info('Session convertStatus updated', { sessionId });

      // Construct S3 HLS URL for transcription pipeline (internal use only)
      const recordingHlsUrl = `s3://${bucket}/hls/${sessionId}/master.m3u8`;

      // Parse thumbnail output group if present
      if (detail.outputGroupDetails && cloudFrontDomain) {
        try {
          // Find the Thumbnails output group — it contains FRAME_CAPTURE .jpg outputs
          for (const group of detail.outputGroupDetails) {
            const outputDetails = group.outputDetails;
            if (!outputDetails || outputDetails.length === 0) continue;

            const filePaths = outputDetails[0].outputFilePaths;
            if (!filePaths || filePaths.length === 0) continue;

            // Check if this is the thumbnail output group (files end with .jpg)
            const lastFilePath = filePaths[filePaths.length - 1];
            if (!lastFilePath.endsWith('.jpg')) continue;

            // Parse thumbnail count from last file path
            // Format: s3://bucket/sessionId/thumbnails/recording-thumb.0000036.jpg
            const indexMatch = lastFilePath.match(/\.(\d+)\.jpg$/);
            if (!indexMatch) continue;

            const lastIndex = parseInt(indexMatch[1], 10);
            const thumbnailCount = lastIndex + 1; // zero-indexed

            // Extract the S3 key portion for CloudFront URL construction
            // lastFilePath format: s3://bucket/sessionId/thumbnails/recording-thumb.0000036.jpg
            const s3Prefix = lastFilePath.replace(/^s3:\/\/[^/]+\//, '');
            // Base path: sessionId/thumbnails/recording-thumb
            const basePathMatch = s3Prefix.match(/^(.+)\.\d+\.jpg$/);
            if (!basePathMatch) continue;

            const thumbnailBasePath = basePathMatch[1];

            // Poster frame: use index 1 (skip first frame which may be black)
            const posterIndex = thumbnailCount > 1 ? 1 : 0;
            const posterFrameUrl = `https://${cloudFrontDomain}/${thumbnailBasePath}.${String(posterIndex).padStart(7, '0')}.jpg`;
            const thumbnailBaseUrl = `https://${cloudFrontDomain}/${thumbnailBasePath}`;

            await updateSessionRecording(tableName, sessionId, {
              posterFrameUrl,
              thumbnailBaseUrl,
              thumbnailCount,
            });

            logger.info('Thumbnail metadata stored', {
              sessionId,
              posterFrameUrl,
              thumbnailBaseUrl,
              thumbnailCount,
            });
            break; // Only process the first thumbnail group found
          }
        } catch (thumbError: any) {
          logger.warn('Failed to parse thumbnail metadata (non-blocking)', {
            sessionId,
            error: thumbError.message,
          });
        }
      }

      // Publish event to trigger Phase 19 transcription pipeline
      // For hangout per-participant jobs, include userId from userMetadata
      const userId = detail.userMetadata?.userId;
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'vnl.upload',
              DetailType: 'Upload Recording Available',
              Detail: JSON.stringify({
                sessionId,
                recordingHlsUrl,
                ...(userId && { userId }),
              }),
              EventBusName: eventBusName,
            },
          ],
        })
      );
      logger.info('Transcription pipeline triggered', { sessionId, userId });
    } else if (status === 'ERROR' || status === 'CANCELED') {
      // MediaConvert job failed
      logger.error('MediaConvert job failed', { jobName, jobId });

      try {
        await emitSessionEvent(tableName, {
          eventId: uuidv4(), sessionId, eventType: SessionEventType.MEDIACONVERT_FAILED,
          timestamp: new Date().toISOString(), actorId: 'SYSTEM',
          actorType: 'system', details: { jobId, status },
        });
      } catch { /* non-blocking */ }

      // Mark session as failed
      await updateSessionRecording(tableName, sessionId, {
        convertStatus: 'failed',
        uploadStatus: 'failed',
      });
    }
  } catch (error) {
    tracer.addErrorAsMetadata(error as Error);
    logger.error('on-mediaconvert-complete error:', { error: error instanceof Error ? error.message : String(error) });
    throw error; // Propagate for SQS retry
  } finally {
    subsegment?.close();
    if (segment) tracer.setSegment(segment);
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    const segment = tracer.getSegment();
    const subsegment = segment?.addNewSubsegment(`## ${record.messageId}`) as Subsegment | undefined;
    if (subsegment) tracer.setSegment(subsegment);

    try {
      // Parse JSON from SQS record body
      let ebEvent: any;
      try {
        ebEvent = JSON.parse(record.body);
      } catch (parseError: any) {
        logger.error('Failed to parse SQS record body as JSON', {
          messageId: record.messageId,
          error: parseError.message,
          handler: 'on-mediaconvert-complete',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate EventBridge envelope
      if (!ebEvent.detail) {
        logger.error('EventBridge event missing detail field', {
          messageId: record.messageId,
          handler: 'on-mediaconvert-complete',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate MediaConvertCompleteDetail schema
      const parseResult = MediaConvertCompleteDetailSchema.safeParse(ebEvent.detail);
      if (!parseResult.success) {
        const fieldErrors = parseResult.error.flatten().fieldErrors;
        logger.error('Invalid MediaConvert job detail', {
          messageId: record.messageId,
          handler: 'on-mediaconvert-complete',
          fieldErrors,
          detail: JSON.stringify(ebEvent.detail),
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validation passed — call processEvent with typed detail
      const typedEvent: EventBridgeEvent<string, MediaConvertCompleteDetail> = {
        ...ebEvent,
        detail: parseResult.data,
      };
      await processEvent(typedEvent);
    } catch (err: any) {
      tracer.addErrorAsMetadata(err as Error);
      logger.error('Failed to process SQS record', {
        messageId: record.messageId,
        error: err.message,
      });
      failures.push({ itemIdentifier: record.messageId });
    } finally {
      subsegment?.close();
      if (segment) tracer.setSegment(segment);
    }
  }

  return { batchItemFailures: failures };
};
