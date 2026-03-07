import { EventBridgeEvent } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';

const transcribe = new TranscribeClient({});

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
  console.log('Received Upload Recording Available event:', JSON.stringify(event.detail));

  try {
    // Extract required fields from event detail
    const { sessionId, recordingHlsUrl } = event.detail;

    // Validate required fields
    if (!sessionId || !recordingHlsUrl) {
      console.error('Missing required fields in event detail:', {
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

    console.log('Starting Transcribe job:', {
      jobName,
      audioFileUri,
      outputLocation: `s3://${process.env.TRANSCRIPTION_BUCKET}/${sessionId}/transcript.json`,
    });

    // Start the Transcribe job
    const command = new StartTranscriptionJobCommand(transcribeParams);
    const response = await transcribe.send(command);

    console.log('Transcribe job started successfully:', {
      jobName: response.TranscriptionJob?.TranscriptionJobName,
      status: response.TranscriptionJob?.TranscriptionJobStatus,
    });

  } catch (error) {
    // Log error but don't throw - non-blocking pattern
    console.error('Failed to start Transcribe job:', error);
  }
}