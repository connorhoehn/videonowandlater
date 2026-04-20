/**
 * POST /sessions/{sessionId}/clips/live
 *
 * Capture the last ~10 seconds of a LIVE session as an mp4 clip. The viewer
 * taps a "clip that moment" button; we record the intent synchronously and
 * return {clipId, status: 'pending'}. The actual segment-pull + mp4 encode
 * happens asynchronously — see the "Processor TODO" block below.
 *
 * This differs from the existing post-session clip flow (create-clip.ts) which
 * runs MediaConvert InputClippings against a FINALIZED recording mp4. Here
 * the recording is not yet finalized, so we'll eventually fetch HLS media
 * segments while the stream is live.
 *
 * Auth: any authenticated user. No extra authorization check beyond session
 * visibility (a caller already watching a private session is fine to clip it).
 *
 * Body: {} (no parameters — the 10-second window is anchored to request time).
 * Returns: 202 { clipId, status: 'pending' }
 *
 *
 * ==========================================================================
 * Processor TODO (out of scope for this ship — keeps the API surface intact):
 * ==========================================================================
 * A follow-up Lambda (e.g. "process-live-clip") triggered by EventBridge /
 * DDB Streams on clipType='live' && status='pending' rows should:
 *   1. Resolve the live HLS playback URL for the session.
 *   2. Fetch the current media playlist (.m3u8) from the IVS channel.
 *   3. Select the last ~5 segments (~10s) covering the
 *      `requestedAt` timestamp — falling back to "tail of the playlist" if
 *      we don't have segment-level timestamps.
 *   4. Concat the TS segments (either via ffmpeg in a container OR submit a
 *      MediaConvert job with `InputClippings` over the HLS parent manifest
 *      with Timecode source = "SPECIFIEDSTART").
 *   5. Upload the resulting mp4 to s3://${recordingsBucket}/live-clips/{clipId}/clip.mp4
 *   6. Call `markLiveClipReady(tableName, sessionId, clipId, mp4Url)` with a
 *      CloudFront/signed URL.
 *
 * Until that Lambda is wired up, `finalize-live-clip.ts` is a manual/scheduled
 * stand-in that flips status→ready with a synthesized mp4Url so the frontend
 * flow is end-to-end testable.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { v4 as uuidv4 } from 'uuid';
import { getSessionById } from '../repositories/session-repository';
import { createClip } from '../repositories/clip-repository';
import { SessionStatus } from '../domain/session';
import { LIVE_CLIP_WINDOW_MS, type Clip } from '../domain/clip';
import { resp, requireUserId, parseJsonBody, mapKnownError } from '../lib/http';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'create-live-clip' },
});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    logger.error('TABLE_NAME not set');
    return resp(500, { error: 'Server misconfigured' });
  }

  let userId: string;
  try {
    userId = requireUserId(event);
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  // Body is required to be {} (or absent) — we accept either. Still parse so
  // a malformed body is caught cleanly.
  const parsed = parseJsonBody(event);
  if (!parsed.ok) return parsed.response;

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    // Only live sessions are clippable via this endpoint. Post-session clips
    // go through the existing POST /sessions/{id}/clips flow.
    if (session.status !== SessionStatus.LIVE) {
      return resp(409, { error: 'Session is not live' });
    }

    if (!session.startedAt) {
      // LIVE without startedAt is an inconsistent state — refuse rather than
      // produce a clip anchored to undefined.
      logger.warn('Live session has no startedAt', { sessionId });
      return resp(409, { error: 'Session has no start timestamp' });
    }

    const nowMs = Date.now();
    const requestedAt = new Date(nowMs).toISOString();
    const sessionStartMs = new Date(session.startedAt).getTime();
    // Anchor the clip window to (now - 10s), relative to session start. Clamp
    // to 0 when the session just began (viewer tapped faster than the window).
    const clipStartRelativeMs = Math.max(0, (nowMs - LIVE_CLIP_WINDOW_MS) - sessionStartMs);

    const clipId = uuidv4();
    const clip: Clip = {
      clipId,
      sessionId,
      authorId: userId,
      clipType: 'live',
      createdAt: requestedAt,
      status: 'pending',
      requestedAt,
      clipStartRelativeMs,
    };

    try {
      await createClip(tableName, clip, { isPublic: !session.isPrivate });
    } catch (err: any) {
      logger.error('createClip persistence failed', {
        error: err?.message,
        clipId,
        sessionId,
      });
      return resp(500, { error: 'Failed to persist live clip' });
    }

    logger.info('Live clip requested', { clipId, sessionId, userId, clipStartRelativeMs });

    return resp(202, { clipId, status: 'pending' });
  } catch (err: any) {
    logger.error('create-live-clip unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: 'Internal server error' });
  }
}
