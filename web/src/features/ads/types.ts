/**
 * Shared types for vnl-ads integration (frontend).
 * Mirrors the backend contract in `backend/src/lib/ad-service-client.ts`.
 */

export interface DrawerItem {
  creativeId: string;
  type: 'promo' | 'product';
  thumbnail: string;
  title: string;
  durationMs: number;
}

/**
 * Overlay payload delivered to viewers via IVS Timed Metadata (broadcast)
 * or `ad_overlay` chat event (hangout). Backend wraps the vnl-ads payload
 * in a `{ type: 'ad', ... }` envelope.
 */
export interface OverlayPayload {
  type: 'ad';
  /** Upstream payload type, e.g. 'sponsor_card' | 'product_pin'. */
  overlayType?: string;
  creativeId?: string;
  title?: string;
  imageUrl?: string;
  durationMs?: number;
  // Additional fields are allowed — vnl-ads may add more.
  [key: string]: unknown;
}
