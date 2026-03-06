/**
 * EventBridge handler for Transcribe job completion events
 * Processes successful Transcribe jobs, fetches transcripts from S3, and stores on session records
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { updateTranscriptStatus } from '../repositories/session-repository';

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
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const detail = event.detail as TranscribeJobDetail;

  const jobName = detail.TranscriptionJobName;
  console.log('Transcribe job event received:', { jobName, status: detail.TranscriptionJobStatus });

  // Parse sessionId from job name (format: vnl-{sessionId}-{epochMs})
  const jobNameParts = jobName.split('-');
  if (jobNameParts.length < 3 || jobNameParts[0] !== 'vnl') {
    console.warn('Cannot parse sessionId from job name:', jobName);
    return;
  }

  const sessionId = jobNameParts[1];

  if (detail.TranscriptionJobStatus === 'FAILED') {
    console.warn('Transcribe job failed for session:', {
      sessionId,
      failureReason: detail.TranscriptionJob?.FailureReason,
    });
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (error: any) {
      console.error('Failed to update transcript status to failed:', error.message);
    }
    return;
  }

  // Job completed — fetch transcript from S3
  console.log('Fetching transcript for session:', sessionId);

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
      console.warn('Transcript text is empty for session:', sessionId);
      await updateTranscriptStatus(
        tableName,
        sessionId,
        'available',
        `s3://${transcriptionBucket}/${transcriptJsonPath}`,
        ''
      );
      return;
    }

    console.log('Parsed transcript:', {
      sessionId,
      textLength: plainText.length,
      wordCount: plainText.split(' ').length,
    });

    // Update session with transcript
    const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
    await updateTranscriptStatus(tableName, sessionId, 'available', s3Uri, plainText);

    console.log('Transcript stored for session:', { sessionId, s3Uri });
  } catch (error: any) {
    console.error('Failed to fetch or store transcript:', error.message);
    try {
      await updateTranscriptStatus(tableName, sessionId, 'failed');
    } catch (updateError: any) {
      console.error('Failed to update transcript status:', updateError.message);
    }
  }
};
