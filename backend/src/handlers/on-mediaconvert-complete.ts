/**
 * Lambda handler for EventBridge MediaConvert job completion events
 * Updates session recording metadata when MediaConvert encoding completes
 * The transcription pipeline is triggered automatically based on recordingStatus field
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { getSessionById, updateSessionRecording } from '../repositories/session-repository';

interface MediaConvertJobDetail {
  jobName: string;
  jobId: string;
  status: 'SUBMITTED' | 'PROGRESSING' | 'COMPLETE' | 'CANCELED' | 'ERROR';
  outputGroupDetails?: Array<{
    playlistFile?: string; // e.g., "master.m3u8"
  }>;
}

export const handler = async (
  event: EventBridgeEvent<'MediaConvert Job State Change', MediaConvertJobDetail>
): Promise<void> => {
  try {
    const tableName = process.env.TABLE_NAME!;
    const bucket = process.env.RECORDINGS_BUCKET!;
    const eventBusName = process.env.EVENT_BUS_NAME!;

    const detail = event.detail;
    const { jobName, jobId, status } = detail;

    console.log(`MediaConvert job state change: ${jobName} (${jobId}) → ${status}`);

    // Parse sessionId from jobName (format: vnl-{sessionId}-{epochMs})
    const jobNameMatch = jobName.match(/^vnl-([a-z0-9-]+)-\d+$/);
    if (!jobNameMatch) {
      console.error(`Could not parse sessionId from jobName: ${jobName}`);
      return;
    }
    const sessionId = jobNameMatch[1];

    // Get session
    const session = await getSessionById(tableName, sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      return;
    }

    if (status === 'COMPLETE') {
      // MediaConvert job succeeded
      const recordingHlsUrl = `s3://${bucket}/hls/${sessionId}/master.m3u8`;

      console.log(`Updating session with HLS URL: ${recordingHlsUrl}`);

      // Update session with all recording metadata atomically
      await updateSessionRecording(tableName, sessionId, {
        recordingHlsUrl,
        recordingStatus: 'available',
        convertStatus: 'available',
        status: 'ended',
      });

      console.log(`Session updated with HLS URL and marked as ended: ${sessionId}`);
    } else if (status === 'ERROR' || status === 'CANCELED') {
      // MediaConvert job failed
      console.error(`MediaConvert job failed: ${jobName} (${jobId})`);

      // Mark session as failed
      await updateSessionRecording(tableName, sessionId, {
        convertStatus: 'failed',
        uploadStatus: 'failed',
      });
    }
  } catch (error) {
    console.error('on-mediaconvert-complete error:', error);
    // Don't rethrow; EventBridge message is consumed even if handler fails
  }
};
