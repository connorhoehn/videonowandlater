/**
 * Clip domain model
 *
 * Two flavors of clips share this type:
 *
 *  - 'postSession' (default, backward compat): a 5-180 second highlight
 *    extracted from an ENDED session's finalized recording via MediaConvert
 *    InputClippings. Uses startSec/endSec/durationSec/mediaConvertJobId.
 *
 *  - 'live': a ~10 second highlight captured WHILE the session is still live.
 *    Created synchronously from the frontend "clip that moment" button; the
 *    real segment-pull + encode happens asynchronously (see
 *    finalize-live-clip.ts and the TODO in create-live-clip.ts).
 *    Uses requestedAt / clipStartRelativeMs / mp4Url, and has its own
 *    status vocabulary 'pending' | 'ready' | 'failed'.
 *
 * Both flavors are persisted identically (session-scoped row + pointer row
 * — see clip-repository.ts). Readers should branch on `clipType` and defer
 * to the flavor-specific fields. Legacy rows written before `clipType`
 * existed should be treated as 'postSession'.
 */

export type ClipType = 'live' | 'postSession';

/** Post-session clip lifecycle (MediaConvert-backed). */
export type PostSessionClipStatus = 'processing' | 'ready' | 'failed' | 'deleted';

/** Live clip lifecycle (segment-pull backed, tighter vocabulary). */
export type LiveClipStatus = 'pending' | 'ready' | 'failed';

/** Union of both statuses so callers can handle either flavor uniformly. */
export type ClipStatus = PostSessionClipStatus | LiveClipStatus;

export interface Clip {
  clipId: string;
  sessionId: string;
  /** User who created the clip */
  authorId: string;
  /**
   * Discriminator. Missing/undefined on legacy rows means 'postSession' — see
   * `getClipType()`.
   */
  clipType?: ClipType;
  /** Title is optional for live clips (auto-generated). Required for post-session. */
  title?: string;
  createdAt: string;
  status: ClipStatus;

  // --- Post-session flavor ---
  /** Start time in seconds (inclusive) relative to the recording's start. */
  startSec?: number;
  /** End time in seconds (exclusive) relative to the recording's start. */
  endSec?: number;
  /** Duration in seconds (endSec - startSec). */
  durationSec?: number;
  /** S3 key of the MP4 output under the recordings bucket (set when status=ready). */
  s3Key?: string;
  /** MediaConvert job id tracked for observability. */
  mediaConvertJobId?: string;

  // --- Live flavor ---
  /** ISO timestamp when the viewer tapped the clip button (server time). */
  requestedAt?: string;
  /**
   * Server-computed offset into the live session where the clip should START.
   * = (requestedAt_ms - 10_000) - session.startedAt_ms.
   * Negative values are clamped to 0 by the processor.
   */
  clipStartRelativeMs?: number;
  /** Public or signed mp4 URL populated when status='ready'. */
  mp4Url?: string;
}

/**
 * Returns the effective clipType for a clip row, defaulting legacy rows to
 * 'postSession' for backward compatibility.
 */
export function getClipType(clip: Pick<Clip, 'clipType'>): ClipType {
  return clip.clipType ?? 'postSession';
}

/** Minimum and maximum allowed clip durations (post-session clips). */
export const CLIP_MIN_DURATION_SEC = 5;
export const CLIP_MAX_DURATION_SEC = 180;

/** Fixed duration captured for a live "clip that moment" action (10 seconds). */
export const LIVE_CLIP_WINDOW_MS = 10_000;
