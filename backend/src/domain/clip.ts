/**
 * Clip domain model
 *
 * A Clip is a 5-180 second highlight extracted by a viewer from an ended session
 * recording via MediaConvert InputClippings. Stored both as a per-session row
 * (PK: SESSION#{sessionId}, SK: CLIP#{clipId}) and a pointer row
 * (PK: CLIP#{clipId}, SK: METADATA) for direct lookups without knowing the session.
 */

export type ClipStatus = 'processing' | 'ready' | 'failed' | 'deleted';

export interface Clip {
  clipId: string;
  sessionId: string;
  /** User who created the clip */
  authorId: string;
  title: string;
  /** Start time in seconds (inclusive) relative to the recording's start */
  startSec: number;
  /** End time in seconds (exclusive) relative to the recording's start */
  endSec: number;
  /** Duration in seconds (endSec - startSec) */
  durationSec: number;
  createdAt: string;
  status: ClipStatus;
  /** S3 key of the MP4 output under the recordings bucket (set when status=ready) */
  s3Key?: string;
  /** MediaConvert job id tracked for observability */
  mediaConvertJobId?: string;
}

/** Minimum and maximum allowed clip durations */
export const CLIP_MIN_DURATION_SEC = 5;
export const CLIP_MAX_DURATION_SEC = 180;
