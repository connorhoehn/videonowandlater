/**
 * Lambda handler for EventBridge MediaConvert job completion events
 * Updates session recording metadata when MediaConvert encoding completes
 * Publishes an explicit EventBridge event to trigger Phase 19 transcription pipeline
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { getSessionById, updateSessionRecording } from '../repositories/session-repository';

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'on-mediaconvert-complete' },
});
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

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
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment('## handler') as Subsegment | undefined;
  if (subsegment) tracer.setSegment(subsegment);

  try {
    tracer.putAnnotation('pipelineStage', 'on-mediaconvert-complete');

    const tableName = process.env.TABLE_NAME!;
    const bucket = process.env.RECORDINGS_BUCKET!;
    const eventBusName = process.env.EVENT_BUS_NAME!;

    const detail = event.detail;
    const { jobName, jobId, status } = detail;

    logger.info('MediaConvert job state change', { jobName, jobId, status });

    // Parse sessionId from jobName (format: vnl-{sessionId}-{epochMs})
    const jobNameMatch = jobName.match(/^vnl-([a-z0-9-]+)-\d+$/);
    if (!jobNameMatch) {
      console.error(`Could not parse sessionId from jobName: ${jobName}`);
      return;
    }
    const sessionId = jobNameMatch[1];

    tracer.putAnnotation('sessionId', sessionId);

    // Get session
    const session = await getSessionById(tableName, sessionId);
    if (!session) {
      console.error(`Session not found: ${sessionId}`);
      return;
    }

    if (status === 'COMPLETE') {
      // MediaConvert job succeeded
      const recordingHlsUrl = `s3://${bucket}/hls/${sessionId}/master.m3u8`;

      logger.info('Updating session with HLS URL', { sessionId, recordingHlsUrl });

      // Update session with all recording metadata atomically
      await updateSessionRecording(tableName, sessionId, {
        recordingHlsUrl,
        recordingStatus: 'available',
        convertStatus: 'available',
        status: 'ended',
      });

      logger.info('Session updated with HLS URL and marked as ended', { sessionId });

      // Publish event to trigger Phase 19 transcription pipeline
      await eventBridgeClient.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'vnl.upload',
              DetailType: 'Upload Recording Available',
              Detail: JSON.stringify({
                sessionId,
                recordingHlsUrl,
              }),
              EventBusName: eventBusName,
            },
          ],
        })
      );
      logger.info('Transcription pipeline triggered', { sessionId });
    } else if (status === 'ERROR' || status === 'CANCELED') {
      // MediaConvert job failed
      logger.error('MediaConvert job failed', { jobName, jobId });

      // Mark session as failed
      await updateSessionRecording(tableName, sessionId, {
        convertStatus: 'failed',
        uploadStatus: 'failed',
      });
    }
  } catch (error) {
    tracer.addErrorAsMetadata(error as Error);
    console.error('on-mediaconvert-complete error:', error);
    throw error; // Propagate to EventBridge for retry
  } finally {
    subsegment?.close();
    if (segment) tracer.setSegment(segment);
  }
};
