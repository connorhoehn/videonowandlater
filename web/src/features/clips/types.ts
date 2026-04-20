/**
 * Types for the live-clips feature.
 *
 * Mirrors the backend Clip domain type (backend/src/domain/clip.ts) but
 * with the fields the API actually returns to the caller (no DynamoDB keys,
 * no mediaConvertJobId). The "clipType" discriminator distinguishes the two
 * flavors; most fields are optional since each flavor uses a disjoint subset.
 */

export type ClipType = 'live' | 'postSession';

/** Post-session clip status vocabulary (MediaConvert-backed). */
export type PostSessionClipStatus = 'processing' | 'ready' | 'failed' | 'deleted';

/** Live clip status vocabulary. */
export type LiveClipStatus = 'pending' | 'ready' | 'failed';

export type ClipStatus = PostSessionClipStatus | LiveClipStatus;

/**
 * Shape returned by GET /me/clips — see backend/list-my-clips.ts.
 */
export interface Clip {
  clipId: string;
  sessionId: string;
  authorId: string;
  clipType: ClipType;
  title?: string;
  createdAt: string;
  status: ClipStatus;

  // Post-session fields (undefined on live clips).
  startSec?: number;
  endSec?: number;
  durationSec?: number;

  // Live-clip fields (undefined on post-session clips).
  requestedAt?: string;
  clipStartRelativeMs?: number;
  mp4Url?: string;
}

/** Narrowed view of a live clip. */
export interface LiveClip extends Clip {
  clipType: 'live';
  status: LiveClipStatus;
}

export function isLiveClip(clip: Clip): clip is LiveClip {
  return clip.clipType === 'live';
}
