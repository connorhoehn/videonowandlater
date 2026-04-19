/**
 * Shared types for vnl-ads integration (frontend).
 * Mirrors the backend contract in `backend/src/lib/ad-service-client.ts`.
 * Source of truth: vnl-ads/docs/integration.md.
 */

export interface DrawerItem {
  creativeId: string;
  type: 'promo' | 'product' | 'PROMO' | 'PRODUCT';
  thumbnail: string;
  title: string;
  durationMs: number;
}

/** Latest schema version we know how to render. */
export const OVERLAY_SCHEMA_VERSION = 1;

/**
 * Overlay payload delivered to viewers via IVS Timed Metadata (broadcast)
 * or `ad_overlay` chat event (hangout). Backend wraps the vnl-ads payload
 * in a `{ type: 'ad', ... }` envelope.
 *
 * `schemaVersion` drives rendering — unknown versions MUST be skipped.
 * `cta.clickResolveEndpoint` is currently always `/v1/click`; we route on it
 * so vnl-ads can move the resolver later without a vnl redeploy.
 */
export interface OverlayPayload {
  type: 'ad';
  schemaVersion?: number;
  /** Upstream payload type, e.g. 'sponsor_card' | 'product_pin' | 'PROMO' | 'PRODUCT'. */
  overlayType?: string;
  creativeId?: string;
  title?: string;
  imageUrl?: string;
  durationMs?: number;
  cta?: {
    clickResolveEndpoint?: string;
    label?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
