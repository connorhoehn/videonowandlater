/**
 * Ad domain model
 *
 * Platform-owned sponsored content injected into the stories strip.
 * Exactly one Ad may be `active` at a time — activating a new Ad
 * atomically deactivates any previously-active one.
 *
 * Two creation paths:
 *   - `recording`: admin captures via the camera primitive and uploads to
 *     our recordings bucket.
 *   - `polly`: admin synthesizes from text via the vnl-ads
 *     /v1/synth/announcement endpoint; the resulting MP4 lives on the
 *     vnl-ads CloudFront distribution and we store only the URL.
 *
 * DynamoDB rows:
 *   PK: AD#{id}       SK: METADATA       (the ad itself; `active` is NOT stored here)
 *   PK: AD#ACTIVE     SK: METADATA       (sentinel pointer row; exists iff some ad
 *                                         is active. adId field points at it. Writing
 *                                         this row activates; deleting deactivates.)
 *
 * `active` on the Ad type is computed at read time by comparing each row's id to
 * the pointer's adId. This keeps activation a single atomic PutItem — no
 * transactional multi-item writes to keep bool flags in sync.
 */

export type AdSource = 'recording' | 'polly';
export type AdPlacement = 'story-inline';

export interface Ad {
  id: string;
  source: AdSource;
  mediaUrl: string;
  thumbnailUrl?: string;
  durationSec: number;
  /** sha256 hex of the MP4 — set when source === 'polly' to dedup on Publish retries */
  contentHash?: string;
  /** Short human-readable admin label shown in the creative list */
  label: string;
  placement: AdPlacement;
  active: boolean;
  createdAt: string;
  createdBy: string;
}

/** Admin labels are rendered in a compact list — keep them short */
export const AD_LABEL_MAX_CHARS = 80;
