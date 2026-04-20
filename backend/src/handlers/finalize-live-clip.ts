/**
 * finalize-live-clip — PLACEHOLDER for the real segment-pull processor.
 *
 * This handler takes a clipId (live-clip row) and flips its status from
 * 'pending' to 'ready', populating `mp4Url` with a synthesized S3/CloudFront
 * URL. The point is to unblock the frontend flow (useLiveClips polling,
 * "Clip ready — view" UI) without needing the real IVS segment fetch /
 * MediaConvert wiring in place.
 *
 * Wire-up options (picked later — this handler is invokable by all of them):
 *   - EventBridge scheduled rule every minute scanning pending clips older
 *     than 20s. (Simplest path to production.)
 *   - EventBridge default-bus rule on a custom "live-clip.requested" event
 *     emitted by create-live-clip.ts (would require adding event emission
 *     there).
 *   - Step Functions with a 20s Wait state.
 *
 * Inputs:
 *   - Direct invoke payload: `{ clipId: string }`
 *   - API Gateway-shaped event with `pathParameters.clipId` (if exposed as a
 *     protected admin endpoint for manual "force ready" testing).
 *
 * Output: the updated clip status, or an error if the clip was not found or
 * was already in a terminal state.
 *
 * TODO (replace this placeholder):
 *   Replace the `synthesizeMp4Url()` stub with the real S3 key produced by
 *   the segment-pull + concat step. See the Processor TODO in
 *   create-live-clip.ts for the full pipeline description.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { getClipById, markLiveClipReady, markLiveClipFailed } from '../repositories/clip-repository';
import { getClipType } from '../domain/clip';

const logger = new Logger({
  serviceName: 'vnl-worker',
  persistentKeys: { handler: 'finalize-live-clip' },
});

export interface FinalizeLiveClipInput {
  clipId: string;
  /** If true, mark the clip failed instead of ready (for testing the sad path). */
  fail?: boolean;
}

export interface FinalizeLiveClipResult {
  clipId: string;
  status: 'ready' | 'failed';
  mp4Url?: string;
}

/**
 * Synthesize a placeholder mp4 URL pointing at the recordings bucket, so
 * the frontend can render the "Clip ready — view" link. When the real
 * segment-pull processor lands it should instead upload to this prefix and
 * pass the resulting key/URL directly to `markLiveClipReady`.
 */
function synthesizeMp4Url(clipId: string): string {
  const bucket = process.env.RECORDINGS_BUCKET;
  const cfDomain = process.env.RECORDINGS_CF_DOMAIN;
  if (cfDomain) {
    return `https://${cfDomain}/live-clips/${clipId}/clip.mp4`;
  }
  if (bucket) {
    return `https://${bucket}.s3.amazonaws.com/live-clips/${clipId}/clip.mp4`;
  }
  // Dev fallback so local runs don't blow up when env isn't wired yet.
  return `https://example.invalid/live-clips/${clipId}/clip.mp4`;
}

export async function finalizeLiveClip(input: FinalizeLiveClipInput): Promise<FinalizeLiveClipResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error('TABLE_NAME not set');

  const { clipId, fail } = input;
  if (!clipId) throw new Error('clipId is required');

  const clip = await getClipById(tableName, clipId);
  if (!clip) throw new Error(`Clip not found: ${clipId}`);
  if (getClipType(clip) !== 'live') {
    throw new Error(`Clip ${clipId} is not a live clip (clipType=${getClipType(clip)})`);
  }
  if (clip.status !== 'pending') {
    logger.info('Clip is not pending; no-op', { clipId, status: clip.status });
    return { clipId, status: clip.status === 'failed' ? 'failed' : 'ready', mp4Url: clip.mp4Url };
  }

  if (fail) {
    await markLiveClipFailed(tableName, clip.sessionId, clipId);
    logger.info('Live clip marked failed', { clipId, sessionId: clip.sessionId });
    return { clipId, status: 'failed' };
  }

  const mp4Url = synthesizeMp4Url(clipId);
  await markLiveClipReady(tableName, clip.sessionId, clipId, mp4Url);
  logger.info('Live clip marked ready (placeholder)', {
    clipId,
    sessionId: clip.sessionId,
    mp4Url,
  });
  return { clipId, status: 'ready', mp4Url };
}

/**
 * Lambda entrypoint. Accepts either a direct-invoke shape `{ clipId }`, an
 * EventBridge detail `{ detail: { clipId } }`, or an API Gateway event with
 * `pathParameters.clipId`.
 */
export async function handler(event: any): Promise<FinalizeLiveClipResult> {
  const clipId: string | undefined =
    event?.clipId ??
    event?.detail?.clipId ??
    event?.pathParameters?.clipId;
  const fail: boolean | undefined = event?.fail ?? event?.detail?.fail;

  if (!clipId) throw new Error('clipId missing from event');
  return finalizeLiveClip({ clipId, fail });
}
