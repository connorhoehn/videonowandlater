/**
 * SQS-wrapped handler for MediaConvert job completion events
 * Processes successful MediaConvert jobs and submits Transcribe jobs for transcription
 * Receives EventBridge events via SQS queue for at-least-once delivery with DLQ support.
 */

import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { Logger } from '@aws-lambda-powertools/logger';
import { TranscodeCompletedDetailSchema, type TranscodeCompletedDetail } from './schemas/transcode-completed.schema';
import { updateTranscriptStatus } from '../repositories/session-repository';

export const tracer = new Tracer({ serviceName: 'vnl-pipeline' });

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'transcode-completed' },
});

interface MediaConvertJobDetail {
  status: 'COMPLETE' | 'ERROR' | 'CANCELED';
  outputGroupDetails?: Array<{
    outputDetails?: Array<{
      outputFilePaths?: string[]; // S3 paths of output files
    }>;
  }>;
  userMetadata?: {
    sessionId?: string;
    phase?: string;
  };
}

async function processEvent(
  event: EventBridgeEvent<string, TranscodeCompletedDetail>,
  tracer: Tracer,
  transcribeClient: TranscribeClient
): Promise<void> {
  const startMs = Date.now();
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const detail = event.detail as any;

  // MediaConvert events include jobId and userMetadata, not jobName
  const jobId: string = detail.jobId;
  const userMetadata = detail.userMetadata || {};
  const sessionId = userMetadata.sessionId;

  tracer.putAnnotation('sessionId', sessionId ?? 'unknown');
  logger.appendPersistentKeys({ sessionId: sessionId ?? 'unknown' });
  logger.info('Pipeline stage entered', { jobId, status: detail.status });

  logger.info('MediaConvert job completed:', { jobId, sessionId, status: detail.status });

  // Validate sessionId from userMetadata
  if (!sessionId) {
    logger.warn('No sessionId found in userMetadata:', { userMetadata });
    return;
  }

  if (detail.status === 'ERROR' || detail.status === 'CANCELED') {
    logger.warn('MediaConvert job failed or canceled for session:', { sessionId, status: detail.status });
    // Update session to reflect transcription failure (non-blocking)
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (error: any) {
      logger.error('Failed to update transcript status to failed:', { errorMessage: error.message });
    }
    return;
  }

  // Extract MP4 output path from MediaConvert result
  const outputPaths = detail.outputGroupDetails?.[0]?.outputDetails?.[0]?.outputFilePaths || [];
  const mp4OutputPath = outputPaths.find((p: string) => p.endsWith('.mp4'));

  if (!mp4OutputPath) {
    logger.warn('Could not find MP4 output in MediaConvert result:', { outputPaths });
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (error: any) {
      logger.error('Failed to update transcript status:', { errorMessage: error.message });
    }
    return;
  }

  logger.info('Starting Transcribe job for session:', { sessionId, mp4Input: mp4OutputPath });

  try {
    const transcribeJobName = `vnl-${sessionId}-${jobId}`;

    const startJobCommand = new StartTranscriptionJobCommand({
      TranscriptionJobName: transcribeJobName,
      Media: {
        MediaFileUri: mp4OutputPath,
      },
      MediaFormat: 'mp4',
      LanguageCode: 'en-US',
      OutputBucketName: transcriptionBucket,
      OutputKey: `${sessionId}/transcript.json`,
      Settings: {
        VocabularyName: undefined,
        ShowAlternatives: false,
        MaxSpeakerLabels: 12,
        ShowSpeakerLabels: false,
      },
    });

    const result = await transcribeClient.send(startJobCommand);
    logger.info('Transcribe job started:', {
      jobName: result.TranscriptionJob?.TranscriptionJobName,
      sessionId,
      status: result.TranscriptionJob?.TranscriptionJobStatus,
    });

    // Update session: transcriptStatus = 'processing'
    await updateTranscriptStatus(tableName, sessionId, 'processing');
    logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
  } catch (error: any) {
    if (error.name === 'ConflictException') {
      // Job was already submitted in a previous attempt — idempotent success
      logger.info('Transcribe job already exists (idempotent retry)', {
        transcribeJobName: `vnl-${sessionId}-${jobId}`,
        sessionId,
      });
      // Ensure status is marked processing (may not be set if previous attempt failed after submit)
      await updateTranscriptStatus(tableName, sessionId, 'processing');
      return;
    }
    logger.error('Failed to submit Transcribe job:', {
      errorMessage: error.message,
      sessionId,
      transcribeJobName: `vnl-${sessionId}-${jobId}`,
    });
    logger.error('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs, errorMessage: error.message });
    throw error; // Transient failure — let SQS retry
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];
  const parentSegment = tracer.getSegment();

  // Wrap TranscribeClient with X-Ray tracing on each invocation.
  // Per-invocation wrapping satisfies the test contract (beforeEach clears mock state).
  const transcribeClient = tracer.captureAWSv3Client(new TranscribeClient({}));

  for (const record of event.Records) {
    let subsegment: Subsegment | undefined;
    try {
      const ebEvent = JSON.parse(record.body) as EventBridgeEvent<string, Record<string, any>>;
      subsegment = parentSegment?.addNewSubsegment('## processRecord') as Subsegment | undefined;
      if (subsegment) tracer.setSegment(subsegment);

      tracer.putAnnotation('pipelineStage', 'transcode-completed');

      // Validate EventBridge envelope
      if (!ebEvent.detail) {
        logger.error('Missing EventBridge detail field', { messageId: record.messageId });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate detail schema
      const detailResult = TranscodeCompletedDetailSchema.safeParse(ebEvent.detail);
      if (!detailResult.success) {
        const fieldErrors = detailResult.error.flatten().fieldErrors;
        logger.error('Event validation failed', {
          messageId: record.messageId,
          handler: 'transcode-completed',
          validationErrors: Object.entries(fieldErrors).map(([field, messages]) => ({
            field,
            issues: messages,
          })),
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      await processEvent(ebEvent as EventBridgeEvent<string, TranscodeCompletedDetail>, tracer, transcribeClient);
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
