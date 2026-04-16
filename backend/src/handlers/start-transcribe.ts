/**
 * SQS-wrapped handler that starts AWS Transcribe jobs when recordings are available.
 * Triggered by 'Upload Recording Available' events from the MediaConvert completion handler.
 * Receives EventBridge events via SQS queue for at-least-once delivery with DLQ support.
 */

import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { Logger } from '@aws-lambda-powertools/logger';
import { UploadRecordingAvailableDetailSchema, type UploadRecordingAvailableDetail } from './schemas/start-transcribe.schema';

const transcribe = new TranscribeClient({});

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'start-transcribe' },
});

/**
 * Determine if an error is transient and should trigger SQS retry.
 * Transient errors: ThrottlingException, ServiceUnavailableException, etc.
 * These will be rethrown to allow SQS to add the message to batchItemFailures.
 */
function isTransientError(error: any): boolean {
  const errorName = error.name || error.__type;
  return [
    'ThrottlingException',
    'ServiceUnavailableException',
    'RequestLimitExceededException',
    'InternalFailureException',
  ].includes(errorName);
}

async function processEvent(
  event: EventBridgeEvent<'Upload Recording Available', UploadRecordingAvailableDetail>
): Promise<void> {
  const startMs = Date.now();

  logger.info('Received Upload Recording Available event:', { detail: event.detail });

  // Extract required fields from event detail
  const { sessionId, recordingHlsUrl, userId } = event.detail;

  logger.appendPersistentKeys({ sessionId: sessionId ?? 'unknown' });
  logger.info('Pipeline stage entered', { recordingHlsUrl, userId });

  // Validate required fields (defensive programming, already validated at handler boundary)
  if (!sessionId || !recordingHlsUrl) {
    logger.error('Missing required fields in event detail:', { sessionId, recordingHlsUrl });
    return;
  }

  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;

  // Per-participant hangout recording: userId present in event detail
  if (userId) {
    // MediaConvert input is multivariant.m3u8 + NameModifier 'recording' = multivariantrecording.mp4
    const audioFileUri = `s3://${transcriptionBucket}/${sessionId}/participants/${userId}/multivariantrecording.mp4`;
    const jobName = `vnl-${sessionId}-${userId}-${Date.now()}`;
    const outputKey = `${sessionId}/participants/${userId}/transcript.json`;

    logger.info('Starting per-participant Transcribe job', { sessionId, userId, audioFileUri });

    const command = new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      Media: { MediaFileUri: audioFileUri },
      OutputBucketName: transcriptionBucket,
      OutputKey: outputKey,
      LanguageCode: 'en-US' as const,
      // No speaker diarization needed — single speaker per recording
    });

    const response = await transcribe.send(command);
    logger.info('Per-participant Transcribe job started', {
      jobName: response.TranscriptionJob?.TranscriptionJobName,
      status: response.TranscriptionJob?.TranscriptionJobStatus,
      userId,
    });
    logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
    return;
  }

  // Standard broadcast flow: single composite recording
  const audioFileUri = `s3://${transcriptionBucket}/${sessionId}/masterrecording.mp4`;
  const jobName = `vnl-${sessionId}-${Date.now()}`;

  logger.info('Derived audio file URI', { sessionId, audioFileUri });

  const transcribeParams = {
    TranscriptionJobName: jobName,
    Media: { MediaFileUri: audioFileUri },
    OutputBucketName: transcriptionBucket,
    OutputKey: `${sessionId}/transcript.json`,
    LanguageCode: 'en-US' as const,
    Settings: {
      ShowSpeakerLabels: true,
      MaxSpeakerLabels: 2,
    },
  };

  logger.info('Starting Transcribe job:', {
    jobName,
    audioFileUri,
    outputLocation: `s3://${transcriptionBucket}/${sessionId}/transcript.json`,
  });

  const command = new StartTranscriptionJobCommand(transcribeParams);
  const response = await transcribe.send(command);

  logger.info('Transcribe job started successfully:', {
    jobName: response.TranscriptionJob?.TranscriptionJobName,
    status: response.TranscriptionJob?.TranscriptionJobStatus,
  });
  logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      // Parse JSON
      let ebEvent: EventBridgeEvent<'Upload Recording Available', any>;
      try {
        ebEvent = JSON.parse(record.body);
      } catch (parseError: any) {
        // JSON parse errors are system-level, should retry
        logger.error('Failed to parse SQS message body as JSON', {
          messageId: record.messageId,
          error: parseError.message,
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate EventBridge envelope
      if (!ebEvent.detail) {
        logger.error('Missing EventBridge detail field', { messageId: record.messageId });
        // Missing detail is a validation failure — route to DLQ
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate detail schema
      const detailResult = UploadRecordingAvailableDetailSchema.safeParse(ebEvent.detail);
      if (!detailResult.success) {
        const fieldErrors = detailResult.error.flatten().fieldErrors;
        logger.error('Event validation failed', {
          messageId: record.messageId,
          handler: 'start-transcribe',
          validationErrors: Object.entries(fieldErrors).map(([field, messages]) => ({
            field,
            issues: messages,
          })),
        });
        // Validation failure — route to DLQ for investigation
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validation passed, process with typed detail
      await processEvent(ebEvent as EventBridgeEvent<'Upload Recording Available', UploadRecordingAvailableDetail>);
    } catch (err: any) {
      // Catch errors from processEvent (Transcribe API errors)
      // Distinguish transient from permanent
      if (isTransientError(err)) {
        logger.warn('Transient Transcribe error, will retry via SQS', {
          messageId: record.messageId,
          errorName: err.name || err.__type,
          message: err.message,
        });
        // Add to failures to trigger SQS retry
        failures.push({ itemIdentifier: record.messageId });
      } else {
        // Permanent error (shouldn't happen with valid contract, but guard against it)
        logger.error('Permanent Transcribe error, acknowledging message', {
          messageId: record.messageId,
          errorName: err.name,
          message: err.message,
        });
        // Do NOT add to failures — acknowledge and move on
      }
    }
  }

  return { batchItemFailures: failures };
};
