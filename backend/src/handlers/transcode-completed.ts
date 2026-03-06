/**
 * EventBridge handler for MediaConvert job completion events
 * Processes successful MediaConvert jobs and submits Transcribe jobs for transcription
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { updateTranscriptStatus } from '../repositories/session-repository';

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

export const handler = async (
  event: EventBridgeEvent<string, Record<string, any>>
): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const detail = event.detail as any;

  // MediaConvert events include jobId and userMetadata, not jobName
  const jobId: string = detail.jobId;
  const userMetadata = detail.userMetadata || {};
  const sessionId = userMetadata.sessionId;

  console.log('MediaConvert job completed:', { jobId, sessionId, status: detail.status });

  // Validate sessionId from userMetadata
  if (!sessionId) {
    console.warn('No sessionId found in userMetadata:', userMetadata);
    return;
  }

  if (detail.status === 'ERROR' || detail.status === 'CANCELED') {
    console.warn('MediaConvert job failed or canceled for session:', { sessionId, status: detail.status });
    // Update session to reflect transcription failure (non-blocking)
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (error: any) {
      console.error('Failed to update transcript status to failed:', error.message);
    }
    return;
  }

  // Extract MP4 output path from MediaConvert result
  const outputPaths = detail.outputGroupDetails?.[0]?.outputDetails?.[0]?.outputFilePaths || [];
  const mp4OutputPath = outputPaths.find((p: string) => p.endsWith('.mp4'));

  if (!mp4OutputPath) {
    console.warn('Could not find MP4 output in MediaConvert result:', outputPaths);
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (error: any) {
      console.error('Failed to update transcript status:', error.message);
    }
    return;
  }

  console.log('Starting Transcribe job for session:', { sessionId, mp4Input: mp4OutputPath });

  try {
    const transcribeClient = new TranscribeClient({ region: process.env.AWS_REGION });
    const epochMs = Date.now();
    const transcribeJobName = `vnl-${sessionId}-${epochMs}`;

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
    console.log('Transcribe job started:', {
      jobName: result.TranscriptionJob?.TranscriptionJobName,
      sessionId,
      status: result.TranscriptionJob?.TranscriptionJobStatus,
    });

    // Update session: transcriptStatus = 'processing'
    await updateTranscriptStatus(tableName, sessionId, 'processing');
  } catch (error: any) {
    console.error('Failed to submit Transcribe job:', error.message);
    // Non-blocking: update session status to failed
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (updateError: any) {
      console.error('Failed to update transcript status:', updateError.message);
    }
  }
};
