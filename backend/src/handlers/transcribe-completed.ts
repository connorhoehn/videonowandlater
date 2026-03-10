/**
 * EventBridge handler for Transcribe job completion events
 * Processes successful Transcribe jobs, fetches transcripts from S3, and stores on session records
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { updateTranscriptStatus } from '../repositories/session-repository';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'transcribe-completed' },
});

interface TranscribeJobDetail {
  TranscriptionJobStatus: 'COMPLETED' | 'FAILED';
  TranscriptionJobName: string;
  TranscriptionJob?: {
    TranscriptFileUri?: string;
    FailureReason?: string;
  };
}

interface TranscribeOutput {
  results: {
    transcripts: Array<{
      transcript: string;
    }>;
  };
}

export const handler = async (
  event: EventBridgeEvent<string, Record<string, any>>
): Promise<void> => {
  const startMs = Date.now();
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const detail = event.detail as TranscribeJobDetail;

  const jobName = detail.TranscriptionJobName;
  logger.info('Transcribe job event received:', { jobName, status: detail.TranscriptionJobStatus });

  // Parse sessionId from job name (format: vnl-{sessionId}-{epochMs})
  const jobNameMatch = jobName.match(/^vnl-([a-z0-9-]+)-\d+$/);
  if (!jobNameMatch) {
    logger.warn('Cannot parse sessionId from job name:', { jobName });
    return;
  }

  const sessionId = jobNameMatch[1];

  logger.appendPersistentKeys({ sessionId });
  logger.info('Pipeline stage entered', { jobName, transcriptionJobStatus: detail.TranscriptionJobStatus });

  if (detail.TranscriptionJobStatus === 'FAILED') {
    logger.warn('Transcribe job failed for session:', {
      sessionId,
      failureReason: detail.TranscriptionJob?.FailureReason,
    });
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (error: any) {
      logger.error('Failed to update transcript status to failed:', { errorMessage: error.message });
    }
    return;
  }

  // Job completed — fetch transcript from S3
  logger.info('Fetching transcript for session:', { sessionId });

  try {
    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const transcriptJsonPath = `${sessionId}/transcript.json`;

    const getObjectCommand = new GetObjectCommand({
      Bucket: transcriptionBucket,
      Key: transcriptJsonPath,
    });

    const response = await s3Client.send(getObjectCommand);
    const bodyString = await response.Body?.transformToString();
    const transcribeOutput: TranscribeOutput = JSON.parse(bodyString || '{}');

    // Extract plain text transcript
    const plainText = transcribeOutput.results?.transcripts?.[0]?.transcript || '';

    if (!plainText) {
      logger.warn('Transcript text is empty for session:', { sessionId });
      const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
      await updateTranscriptStatus(
        tableName,
        sessionId,
        'available',
        s3Uri,
        ''
      );

      // Emit "Transcript Stored" event for Phase 20 (AI Summary Pipeline) even with empty text
      try {
        const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });
        const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
        await eventBridgeClient.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'custom.vnl',
                DetailType: 'Transcript Stored',
                Detail: JSON.stringify({
                  sessionId,
                  transcriptS3Uri: s3Uri,
                }),
              },
            ],
          })
        );
        logger.info('Transcript Stored event emitted for session:', { sessionId });
      } catch (eventError: any) {
        logger.error('Failed to emit Transcript Stored event:', { errorMessage: eventError.message });
        // Non-blocking: transcript is already stored, don't throw or prevent completion
      }
      return;
    }

    logger.info('Parsed transcript:', {
      sessionId,
      textLength: plainText.length,
      wordCount: plainText.split(' ').length,
    });

    // Update session with transcript
    const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
    await updateTranscriptStatus(tableName, sessionId, 'available', s3Uri, plainText);

    logger.info('Transcript stored for session:', { sessionId, s3Uri });

    // Emit "Transcript Stored" event for Phase 20 (AI Summary Pipeline)
    try {
      const eventBridgeClient = new EventBridgeClient({ region: process.env.AWS_REGION });
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'custom.vnl',
              DetailType: 'Transcript Stored',
              Detail: JSON.stringify({
                sessionId,
                transcriptS3Uri: s3Uri,
              }),
            },
          ],
        })
      );
      logger.info('Transcript Stored event emitted for session:', { sessionId });
      logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
    } catch (eventError: any) {
      logger.error('Failed to emit Transcript Stored event:', { errorMessage: eventError.message });
      // Non-blocking: transcript is already stored, don't throw or prevent completion
    }
  } catch (error: any) {
    logger.error('Failed to fetch or store transcript:', { errorMessage: error.message });
    logger.error('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs, errorMessage: error.message });
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (updateError: any) {
      logger.error('Failed to update transcript status:', { errorMessage: updateError.message });
    }
  }
};
