/**
 * ad-service-client — typed fetch wrapper for sibling **vnl-ads** service.
 *
 * vnl-ads is being built in parallel. Until it is reachable, every call in this
 * module short-circuits to a safe default ([], null) because `adsEnabled()`
 * returns false when either env var is missing. That is the feature flag:
 * no env → no calls → no errors surface to end users.
 *
 * Contract (the sibling service will expose):
 *   GET  {AD_SERVICE_URL}/v1/creators/{userId}/drawer?sessionId=...
 *        → DrawerItem[]
 *   POST {AD_SERVICE_URL}/v1/trigger
 *        body { creativeId, sessionId, creatorId, triggerType }
 *        → { overlayPayload }
 *   POST {AD_SERVICE_URL}/v1/click
 *        body { creativeId, sessionId, viewerId }
 *        → { ctaUrl }
 *
 * Service-to-service auth: HS256 JWT, short-lived (5min), shared secret.
 * Transport hardening: 3s timeout, one retry on 5xx, graceful network
 * failure → logged warn + default return.
 */

import { createHmac } from 'node:crypto';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { component: 'ad-service-client' } });

const TIMEOUT_MS = 3000;
const JWT_TTL_SECONDS = 300; // 5min

// ── Public types (exposed to handlers + web frontend) ───────────────────────

export interface DrawerItem {
  creativeId: string;
  type: 'promo' | 'product';
  thumbnail: string;
  title: string;
  durationMs: number;
}

/**
 * Overlay payload returned by POST /v1/trigger — this JSON is what we embed
 * into IVS Timed Metadata (broadcast) or `ad_overlay` chat event (hangout).
 *
 * Shape is intentionally loose — vnl-ads will evolve the schema.
 */
export interface OverlayPayload {
  type: string; // e.g. 'sponsor_card' | 'product_pin'
  // Additional fields dictated by vnl-ads — pass through verbatim.
  [key: string]: unknown;
}

export interface TriggerAdInput {
  creativeId: string;
  sessionId: string;
  creatorId: string;
  triggerType: 'manual' | 'scheduled';
}

export interface TrackClickInput {
  creativeId: string;
  sessionId: string;
  viewerId: string;
}

// ── Feature flag ────────────────────────────────────────────────────────────

/**
 * Returns false when either `AD_SERVICE_URL` or `AD_SERVICE_SECRET` is
 * missing / empty. When false, every public fn in this module returns its
 * safe default without issuing a network call.
 */
export function adsEnabled(): boolean {
  const url = process.env.AD_SERVICE_URL;
  const secret = process.env.AD_SERVICE_SECRET;
  return !!url && !!secret && url.length > 0 && secret.length > 0;
}

// ── HS256 JWT signing (Node crypto — no extra deps) ─────────────────────────

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Sign a short-lived HS256 JWT for service-to-service auth with vnl-ads.
 * Claims: `iss=vnl-api`, `iat`, `exp = iat + JWT_TTL_SECONDS`.
 *
 * Exported for unit tests only — handlers should not call this directly.
 */
export function signServiceJwt(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { iss: 'vnl-api', iat: now, exp: now + JWT_TTL_SECONDS };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ── Low-level fetch with timeout + single 5xx retry ─────────────────────────

interface FetchOptions {
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
}

async function fetchWithTimeoutAndRetry(opts: FetchOptions): Promise<Response> {
  const secret = process.env.AD_SERVICE_SECRET!;
  const jwt = signServiceJwt(secret);

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(opts.url, {
        method: opts.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  const first = await doFetch();
  if (first.status >= 500 && first.status < 600) {
    logger.warn('vnl-ads 5xx — retrying once', { url: opts.url, status: first.status });
    return doFetch();
  }
  return first;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * GET the creator's promo drawer from vnl-ads.
 * Returns [] if the feature flag is off or the call fails.
 */
export async function getDrawer(userId: string, sessionId: string): Promise<DrawerItem[]> {
  if (!adsEnabled()) return [];

  const base = process.env.AD_SERVICE_URL!.replace(/\/$/, '');
  const url = `${base}/v1/creators/${encodeURIComponent(userId)}/drawer?sessionId=${encodeURIComponent(sessionId)}`;

  try {
    const res = await fetchWithTimeoutAndRetry({ method: 'GET', url });
    if (!res.ok) {
      logger.warn('vnl-ads getDrawer non-2xx', { status: res.status, userId, sessionId });
      return [];
    }
    const data = (await res.json()) as DrawerItem[];
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logger.warn('vnl-ads getDrawer network error', {
      userId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * POST /v1/trigger — request an overlay payload for a chosen creative.
 * Returns null if the feature flag is off or the call fails.
 */
export async function triggerAd(input: TriggerAdInput): Promise<OverlayPayload | null> {
  if (!adsEnabled()) return null;

  const base = process.env.AD_SERVICE_URL!.replace(/\/$/, '');
  const url = `${base}/v1/trigger`;

  try {
    const res = await fetchWithTimeoutAndRetry({ method: 'POST', url, body: input });
    if (!res.ok) {
      logger.warn('vnl-ads triggerAd non-2xx', {
        status: res.status,
        creativeId: input.creativeId,
        sessionId: input.sessionId,
      });
      return null;
    }
    const data = (await res.json()) as { overlayPayload?: OverlayPayload };
    return data?.overlayPayload ?? null;
  } catch (err) {
    logger.warn('vnl-ads triggerAd network error', {
      creativeId: input.creativeId,
      sessionId: input.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * POST /v1/click — record a click-through and fetch the destination URL.
 * Returns null if the feature flag is off or the call fails.
 */
export async function trackClick(input: TrackClickInput): Promise<{ ctaUrl: string } | null> {
  if (!adsEnabled()) return null;

  const base = process.env.AD_SERVICE_URL!.replace(/\/$/, '');
  const url = `${base}/v1/click`;

  try {
    const res = await fetchWithTimeoutAndRetry({ method: 'POST', url, body: input });
    if (!res.ok) {
      logger.warn('vnl-ads trackClick non-2xx', {
        status: res.status,
        creativeId: input.creativeId,
        sessionId: input.sessionId,
      });
      return null;
    }
    const data = (await res.json()) as { ctaUrl?: string };
    if (!data?.ctaUrl) return null;
    return { ctaUrl: data.ctaUrl };
  } catch (err) {
    logger.warn('vnl-ads trackClick network error', {
      creativeId: input.creativeId,
      sessionId: input.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
