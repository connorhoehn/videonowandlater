/**
 * POST /sessions/{sessionId}/clips
 * Create a new clip from an ended session recording.
 *
 * Auth: any authenticated user. Additional check: caller must be the session
 * owner, an admin, or the session must be public (not isPrivate).
 *
 * Body: { title: string, startSec: number, endSec: number }
 *
 * Validates clip length (5-180s) and that [startSec, endSec] lies within
 * the recording's duration, then submits a MediaConvert job cloning the
 * main recording job template but with InputClippings. Writes a clip row
 * with status=processing and returns { clipId, status: 'processing' }.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { MediaConvertClient, CreateJobCommand } from '@aws-sdk/client-mediaconvert';
import { v4 as uuidv4 } from 'uuid';
import { getSessionById } from '../repositories/session-repository';
import { createClip } from '../repositories/clip-repository';
import { SessionStatus } from '../domain/session';
import { CLIP_MAX_DURATION_SEC, CLIP_MIN_DURATION_SEC, type Clip } from '../domain/clip';
import { isAdmin } from '../lib/admin-auth';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'create-clip' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/**
 * Convert seconds (may include fraction) to MediaConvert timecode HH:MM:SS:FF @ 30fps.
 * Exported for testing.
 */
export function secondsToTimecode(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const whole = Math.floor(clamped);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const frames = Math.floor((clamped - whole) * 30);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

// Module-scope MediaConvert client (re-used across warm invocations)
const mediaConvertClient = new MediaConvertClient({
  endpoint: process.env.MEDIACONVERT_ENDPOINT,
});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  const recordingsBucket = process.env.RECORDINGS_BUCKET;
  const mediaConvertRoleArn = process.env.MEDIACONVERT_ROLE_ARN;
  const awsRegion = process.env.AWS_REGION;
  const awsAccountId = process.env.AWS_ACCOUNT_ID;

  if (!tableName || !recordingsBucket || !mediaConvertRoleArn || !awsRegion || !awsAccountId) {
    logger.error('Missing required environment variables');
    return resp(500, { error: 'Server misconfigured' });
  }

  // Auth
  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  // Parse body
  let body: any;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  const { title, startSec, endSec } = body ?? {};
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return resp(400, { error: 'title is required' });
  }
  if (typeof startSec !== 'number' || typeof endSec !== 'number' ||
      !Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    return resp(400, { error: 'startSec and endSec must be finite numbers' });
  }
  if (startSec < 0) return resp(400, { error: 'startSec must be >= 0' });
  if (endSec <= startSec) return resp(400, { error: 'endSec must be greater than startSec' });

  const durationSec = endSec - startSec;
  if (durationSec < CLIP_MIN_DURATION_SEC || durationSec > CLIP_MAX_DURATION_SEC) {
    return resp(400, {
      error: `Clip length must be between ${CLIP_MIN_DURATION_SEC} and ${CLIP_MAX_DURATION_SEC} seconds`,
    });
  }

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    // Authz: owner OR admin OR public-session viewer
    const isOwner = session.userId === userId;
    const isPublic = !session.isPrivate;
    const admin = isAdmin(event);
    if (!isOwner && !admin && !isPublic) {
      return resp(403, { error: 'Forbidden: session is not public' });
    }

    // Recording must be available (clipping requires a finished MP4)
    if (session.status !== SessionStatus.ENDED) {
      return resp(409, { error: 'Session has not ended yet; cannot clip' });
    }
    if (!session.recordingDuration || session.recordingDuration <= 0) {
      return resp(409, { error: 'Recording duration not available' });
    }

    const recordingDurationSec = session.recordingDuration / 1000;
    if (endSec > recordingDurationSec + 0.5) {
      return resp(400, { error: 'endSec exceeds recording duration' });
    }

    const clipId = uuidv4();
    const createdAt = new Date().toISOString();
    const s3Prefix = `clips/${clipId}`;
    const s3Destination = `s3://${recordingsBucket}/${s3Prefix}/`;

    // Source MP4: the main recording's MediaConvert output. Per project convention,
    // recording-ended writes MP4s into the transcription bucket, but clipping
    // can use the HLS master as input too. Prefer the MP4 recording at
    // s3://{transcriptionBucket}/{sessionId}/recording.mp4 if known, else
    // fall back to the HLS master derived from recordingHlsUrl.
    const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET;
    const sourceMp4 = transcriptionBucket
      ? `s3://${transcriptionBucket}/${sessionId}/recording.mp4`
      : undefined;
    // Fallback: parse HLS master from recordingHlsUrl (s3://bucket/<key prefix>/media/hls/master.m3u8)
    // If recordingHlsUrl is a CloudFront URL we cannot re-derive the bucket reliably.
    const fileInput = sourceMp4;
    if (!fileInput) {
      return resp(500, { error: 'Clip source file not resolvable' });
    }

    const jobName = `vnl-clip-${clipId}`;
    const createJobCommand = new CreateJobCommand({
      Role: mediaConvertRoleArn,
      Queue: `arn:aws:mediaconvert:${awsRegion}:${awsAccountId}:queues/Default`,
      Settings: {
        Inputs: [{
          FileInput: fileInput,
          InputClippings: [{
            StartTimecode: secondsToTimecode(startSec),
            EndTimecode: secondsToTimecode(endSec),
          }],
          AudioSelectors: {
            'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
          },
          VideoSelector: {},
          TimecodeSource: 'ZEROBASED',
        }],
        OutputGroups: [{
          Name: 'File Group',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: { Destination: s3Destination },
          },
          Outputs: [{
            NameModifier: '-clip',
            ContainerSettings: { Container: 'MP4', Mp4Settings: {} },
            VideoDescription: {
              CodecSettings: {
                Codec: 'H_264',
                H264Settings: {
                  Bitrate: 5000000,
                  MaxBitrate: 5000000,
                  RateControlMode: 'VBR',
                  CodecProfile: 'MAIN',
                },
              },
            },
            AudioDescriptions: [{
              AudioSourceName: 'Audio Selector 1',
              CodecSettings: {
                Codec: 'AAC',
                AacSettings: { Bitrate: 128000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48000 },
              },
            }],
            Extension: 'mp4',
          }],
        }],
      },
      Tags: { sessionId, clipId, type: 'clip' },
      UserMetadata: { sessionId, clipId, type: 'clip' },
    });

    let jobId: string | undefined;
    try {
      const result = await mediaConvertClient.send(createJobCommand);
      jobId = result.Job?.Id;
    } catch (err: any) {
      logger.error('MediaConvert CreateJob failed', { error: err?.message, clipId, sessionId });
      return resp(502, { error: 'Failed to submit clip encode job' });
    }

    const clip: Clip = {
      clipId,
      sessionId,
      authorId: userId,
      title: title.trim(),
      startSec,
      endSec,
      durationSec,
      createdAt,
      status: 'processing',
      mediaConvertJobId: jobId,
    };

    try {
      await createClip(tableName, clip, { isPublic });
    } catch (err: any) {
      logger.error('createClip persistence failed', { error: err?.message, clipId, sessionId });
      return resp(500, { error: 'Failed to persist clip' });
    }

    logger.info('Clip job submitted', { clipId, sessionId, jobId, startSec, endSec });

    return resp(202, { clipId, status: 'processing' });
  } catch (err: any) {
    logger.error('create-clip unexpected error', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal server error' });
  }
}
