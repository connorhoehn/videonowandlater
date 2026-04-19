/**
 * SQS-wrapped Lambda handler for MediaConvert clip-job completion events.
 * Filtered upstream by EventBridge rule on UserMetadata.type === 'clip'.
 * Mirrors on-mediaconvert-complete.ts for the main recording pipeline, but
 * updates the per-clip row rather than the session record.
 */

import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { markClipReady, markClipFailed } from '../repositories/clip-repository';
import { OnClipCompleteDetailSchema, type OnClipCompleteDetail } from './schemas/on-clip-complete.schema';

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'on-clip-complete' },
});

async function processEvent(
  event: EventBridgeEvent<string, OnClipCompleteDetail>
): Promise<void> {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment('## processEvent') as Subsegment | undefined;
  if (subsegment) tracer.setSegment(subsegment);

  try {
    tracer.putAnnotation('pipelineStage', 'on-clip-complete');

    const tableName = process.env.TABLE_NAME!;

    const detail = event.detail;
    const { jobId, status } = detail;
    const { clipId, sessionId } = detail.userMetadata;

    tracer.putAnnotation('clipId', clipId);
    tracer.putAnnotation('sessionId', sessionId);
    logger.info('Clip job state change', { jobId, status, clipId, sessionId });

    if (status === 'COMPLETE') {
      // Extract the output file path (s3://bucket/key) and store the key.
      let s3Key: string | undefined;
      if (detail.outputGroupDetails) {
        for (const group of detail.outputGroupDetails) {
          const filePaths = group.outputDetails?.[0]?.outputFilePaths;
          if (filePaths && filePaths.length > 0) {
            s3Key = filePaths[0].replace(/^s3:\/\/[^/]+\//, '');
            break;
          }
        }
      }
      // Fallback key convention if MediaConvert omitted outputGroupDetails
      if (!s3Key) {
        s3Key = `clips/${clipId}/-clip.mp4`;
      }

      await markClipReady(tableName, sessionId, clipId, s3Key);
      logger.info('Clip marked ready', { clipId, sessionId, s3Key });
    } else if (status === 'ERROR' || status === 'CANCELED') {
      await markClipFailed(tableName, sessionId, clipId);
      logger.error('Clip job failed', { clipId, sessionId, jobId, status });
    } else {
      logger.info('Ignoring non-terminal clip status', { status, clipId });
    }
  } catch (error) {
    tracer.addErrorAsMetadata(error as Error);
    logger.error('on-clip-complete error', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
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
      let ebEvent: any;
      try {
        ebEvent = JSON.parse(record.body);
      } catch (parseError: any) {
        logger.error('Failed to parse SQS record body', {
          messageId: record.messageId,
          error: parseError.message,
          handler: 'on-clip-complete',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      if (!ebEvent.detail) {
        logger.error('EventBridge event missing detail field', {
          messageId: record.messageId,
          handler: 'on-clip-complete',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      const parsed = OnClipCompleteDetailSchema.safeParse(ebEvent.detail);
      if (!parsed.success) {
        logger.error('Invalid clip MediaConvert detail', {
          messageId: record.messageId,
          handler: 'on-clip-complete',
          fieldErrors: parsed.error.flatten().fieldErrors,
        });
        // Not a clip event we can process — drop without retry to prevent DLQ poisoning.
        continue;
      }

      const typedEvent: EventBridgeEvent<string, OnClipCompleteDetail> = {
        ...ebEvent,
        detail: parsed.data,
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
