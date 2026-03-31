/**
 * SQS-wrapped Lambda handler for generating highlight reels from chapters
 * Triggered when chapters are stored on a session (EventBridge: "Chapters Stored")
 * Submits a MediaConvert job that clips the best moments from each chapter
 * and produces both landscape (16:9) and vertical (9:16) highlight reel MP4s.
 *
 * CDK EventBridge rule needed:
 *   Source: 'custom.vnl'
 *   DetailType: 'Chapters Stored'
 *   Target: SQS queue -> this Lambda
 *
 * Environment variables required:
 *   TABLE_NAME, TRANSCRIPTION_BUCKET, MEDIACONVERT_ROLE_ARN,
 *   MEDIACONVERT_ENDPOINT, AWS_REGION, AWS_ACCOUNT_ID
 */

import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';
import { getSessionById, updateHighlightReel } from '../repositories/session-repository';
import type { Chapter } from '../domain/session';

/**
 * Available background music tracks in the assets bucket.
 * These will be mixed into highlight reels in a future iteration.
 */
export const MUSIC_TRACKS = [
  'music/upbeat-01.mp3',
  'music/chill-01.mp3',
  'music/energetic-01.mp3',
];

/**
 * Deterministic music track selection based on sessionId hash.
 * Ensures the same session always gets the same track.
 */
export function selectMusicTrack(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash) + sessionId.charCodeAt(i);
    hash |= 0;
  }
  return MUSIC_TRACKS[Math.abs(hash) % MUSIC_TRACKS.length];
}

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'generate-highlight-reel' },
});

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });

/**
 * Convert milliseconds to MediaConvert HH:MM:SS:FF timecode (30fps)
 */
export function msToTimecode(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.floor((ms % 1000) / (1000 / 30));
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

interface ChaptersStoredDetail {
  sessionId: string;
}

async function processEvent(
  detail: ChaptersStoredDetail,
  mediaConvertClient: MediaConvertClient
): Promise<void> {
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const mediaConvertRoleArn = process.env.MEDIACONVERT_ROLE_ARN!;
  const awsRegion = process.env.AWS_REGION!;
  const awsAccountId = process.env.AWS_ACCOUNT_ID!;

  const { sessionId } = detail;
  const startMs = Date.now();

  logger.appendPersistentKeys({ sessionId });
  logger.info('Pipeline stage entered');

  tracer.putAnnotation('sessionId', sessionId);
  tracer.putAnnotation('pipelineStage', 'generate-highlight-reel');

  // Fetch session to get chapters
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    logger.warn('Session not found', { sessionId });
    return;
  }

  // Idempotent guard: skip if already processing or available
  if (session.highlightReelStatus === 'processing' || session.highlightReelStatus === 'available') {
    logger.info('Highlight reel already in progress or available (idempotent skip)', {
      sessionId,
      highlightReelStatus: session.highlightReelStatus,
    });
    return;
  }

  const chapters = session.chapters;
  if (!chapters || chapters.length === 0) {
    logger.warn('No chapters found on session, skipping highlight reel', { sessionId });
    return;
  }

  // Select a deterministic background music track for this session
  const musicTrack = selectMusicTrack(sessionId);
  const assetsBucket = process.env.ASSETS_BUCKET; // optional — for future music mixing

  // Build MediaConvert inputs: one per chapter with input clipping
  // TODO: When ASSETS_BUCKET is configured, add background music mixing:
  //   - Add 'Audio Selector 2' with ExternalAudioFileInput: `s3://${assetsBucket}/${musicTrack}`
  //   - Add second AudioDescription in outputs with RemixSettings for -10dB mixing
  //   - Requires assets bucket with royalty-free tracks at music/*.mp3
  const sourceFile = `s3://${transcriptionBucket}/${sessionId}/recording.mp4`;

  const inputs = chapters.map((chapter: Chapter) => {
    const midpointMs = (chapter.startTimeMs + chapter.endTimeMs) / 2;
    const chapterDuration = chapter.endTimeMs - chapter.startTimeMs;
    const clipDuration = Math.min(10000, chapterDuration);
    const clipStartMs = Math.max(0, midpointMs - clipDuration / 2);
    const clipEndMs = Math.min(clipStartMs + clipDuration, chapter.endTimeMs);

    return {
      FileInput: sourceFile,
      InputClippings: [{
        StartTimecode: msToTimecode(clipStartMs),
        EndTimecode: msToTimecode(clipEndMs),
      }],
      AudioSelectors: {
        'Audio Selector 1': { DefaultSelection: 'DEFAULT' as const },
      },
      VideoSelector: {},
    };
  });

  const epochMs = Date.now();
  const jobName = `vnl-${sessionId}-${epochMs}`;
  const highlightDestination = `s3://${transcriptionBucket}/${sessionId}/highlights/`;

  const createJobCommand = new CreateJobCommand({
    Role: mediaConvertRoleArn,
    Queue: `arn:aws:mediaconvert:${awsRegion}:${awsAccountId}:queues/Default`,
    Settings: {
      Inputs: inputs,
      OutputGroups: [
        {
          Name: 'Landscape',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: highlightDestination,
            },
          },
          Outputs: [{
            ContainerSettings: { Container: 'MP4', Mp4Settings: {} },
            VideoDescription: {
              Width: 1920,
              Height: 1080,
              CodecSettings: {
                Codec: 'H_264',
                H264Settings: {
                  RateControlMode: 'VBR',
                  MaxBitrate: 5000000,
                  Bitrate: 3000000,
                },
              },
            },
            AudioDescriptions: [{
              AudioSourceName: 'Audio Selector 1',
              CodecSettings: {
                Codec: 'AAC',
                AacSettings: {
                  Bitrate: 128000,
                  SampleRate: 48000,
                  CodingMode: 'CODING_MODE_2_0',
                },
              },
            }],
            NameModifier: '-landscape',
            Extension: 'mp4',
          }],
        },
        {
          Name: 'Vertical',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: highlightDestination,
            },
          },
          Outputs: [{
            ContainerSettings: { Container: 'MP4', Mp4Settings: {} },
            VideoDescription: {
              Width: 1080,
              Height: 1920,
              ScalingBehavior: 'STRETCH_TO_OUTPUT',
              CodecSettings: {
                Codec: 'H_264',
                H264Settings: {
                  RateControlMode: 'VBR',
                  MaxBitrate: 5000000,
                  Bitrate: 3000000,
                },
              },
            },
            AudioDescriptions: [{
              AudioSourceName: 'Audio Selector 1',
              CodecSettings: {
                Codec: 'AAC',
                AacSettings: {
                  Bitrate: 128000,
                  SampleRate: 48000,
                  CodingMode: 'CODING_MODE_2_0',
                },
              },
            }],
            NameModifier: '-vertical',
            Extension: 'mp4',
          }],
        },
      ],
    },
    Tags: {
      sessionId,
      phase: 'highlight-reel',
    },
    UserMetadata: {
      sessionId,
      phase: 'highlight-reel',
    },
  });

  try {
    const result = await mediaConvertClient.send(createJobCommand);
    const jobId = result.Job?.Id;

    if (!jobId) {
      throw new Error('MediaConvert did not return a job ID');
    }

    // Mark session as processing and record selected music track
    await updateHighlightReel(tableName, sessionId, {
      highlightReelStatus: 'processing',
      musicTrackKey: musicTrack,
    });

    logger.info('Highlight reel MediaConvert job submitted', {
      jobId,
      jobName,
      sessionId,
      chapterCount: chapters.length,
    });
    logger.info('Pipeline stage completed', { status: 'success', durationMs: Date.now() - startMs });
  } catch (error: any) {
    logger.error('Failed to submit highlight reel MediaConvert job', {
      sessionId,
      error: error.message,
    });

    // Mark as failed (non-blocking)
    try {
      await updateHighlightReel(tableName, sessionId, {
        highlightReelStatus: 'failed',
      });
    } catch (updateError: any) {
      logger.error('Failed to mark highlight reel as failed', { error: updateError.message });
    }

    logger.info('Pipeline stage failed', { status: 'error', durationMs: Date.now() - startMs });
    throw error; // Let SQS retry
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];
  const parentSegment = tracer.getSegment();

  const mediaConvertClient = tracer.captureAWSv3Client(new MediaConvertClient({
    endpoint: process.env.MEDIACONVERT_ENDPOINT,
  }));

  for (const record of event.Records) {
    let subsegment: Subsegment | undefined;
    try {
      subsegment = parentSegment?.addNewSubsegment(`## ${record.messageId}`) as Subsegment | undefined;
      if (subsegment) tracer.setSegment(subsegment);

      const ebEvent = JSON.parse(record.body);

      if (!ebEvent.detail) {
        logger.error('EventBridge event missing detail field', {
          messageId: record.messageId,
          handler: 'generate-highlight-reel',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      const { sessionId } = ebEvent.detail;
      if (!sessionId || typeof sessionId !== 'string') {
        logger.error('Missing or invalid sessionId in event detail', {
          messageId: record.messageId,
          handler: 'generate-highlight-reel',
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      await processEvent(ebEvent.detail as ChaptersStoredDetail, mediaConvertClient);
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
