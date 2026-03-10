import { EventBridgeEvent } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { Logger } from '@aws-lambda-powertools/logger';

const transcribe = new TranscribeClient({});

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'start-transcribe' },
});

interface UploadRecordingAvailableDetail {
  sessionId?: string;
  recordingHlsUrl?: string;
}

/**
 * EventBridge handler that starts AWS Transcribe jobs when recordings are available.
 * Triggered by 'Upload Recording Available' events from the MediaConvert completion handler.
 *
 * @param event - EventBridge event containing sessionId and recordingHlsUrl
 */
export async function handler(
  event: EventBridgeEvent<'Upload Recording Available', UploadRecordingAvailableDetail>
): Promise<void> {
  const startMs = Date.now();

  logger.info('Received Upload Recording Available event:', { detail: event.detail });

  try {
    // Extract required fields from event detail
    const { sessionId, recordingHlsUrl } = event.detail;

    logger.appendPersistentKeys({ sessionId: sessionId ?? 'unknown' });
    logger.info('Pipeline stage entered', { recordingHlsUrl });

    // Validate required fields
    if (!sessionId || !recordingHlsUrl) {
      logger.error('Missing required fields in event detail:', {
        sessionId,
        recordingHlsUrl,
      });
      return;
    }

    // Convert HLS URL to audio MP4 URL
    // From: s3://bucket/hls/sessionId/master.m3u8
    // To:   s3://bucket/recordings/sessionId/audio.mp4
    const audioFileUri = recordingHlsUrl
      .replace('/hls/', '/recordings/')
      .replace('/master.m3u8', '/audio.mp4');

    // Generate job name with timestamp for uniqueness
    const jobName = `vnl-${sessionId}-${Date.now()}`;

    // Prepare Transcribe job parameters
    const transcribeParams = {
      TranscriptionJobName: jobName,
      Media: {
        MediaFileUri: audioFileUri,
      },
      OutputBucketName: process.env.TRANSCRIPTION_BUCKET!,
      OutputKey: `${sessionId}/transcript.json`,
      LanguageCode: 'en-US' as const,
    };

    logger.info('Starting Transcribe job:', {
      jobName,
      audioFileUri,
      outputLocation: `s3://${process.env.TRANSCRIPTION_BUCKET}/${sessionId}/transcript.json`,
    });

    // Start the Transcribe job
    const command = new StartTranscriptionJobCommand(transcribeParams);
    const response = await transcribe.send(command);

    logger.info('Transcribe job started successfully:', {
      jobName: response.TranscriptionJob?.TranscriptionJobName,
      status: response.TranscriptionJob?.TranscriptionJobStatus,
    });
    logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });

  } catch (error) {
    // Log error but don't throw - non-blocking pattern
    logger.error('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs, errorMessage: error instanceof Error ? error.message : String(error) });
  }
}