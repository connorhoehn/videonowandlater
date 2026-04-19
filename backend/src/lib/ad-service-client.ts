/**
 * ad-service-client — typed fetch wrapper for sibling **vnl-ads** service.
 *
 * Contract + JWT spec source of truth: `vnl-ads/docs/integration.md`.
 *
 * Endpoints:
 *   GET  {VNL_ADS_BASE_URL}/v1/creators/{userId}/drawer?sessionId=...
 *        → DrawerItem[]
 *   POST {VNL_ADS_BASE_URL}/v1/trigger
 *        body { creativeId, sessionId, creatorId, triggerType }
 *        → { overlayPayload }
 *   POST {VNL_ADS_BASE_URL}/v1/click
 *        body { creativeId, sessionId, viewerId }
 *        → { ctaUrl }
 *
 * Auth: HS256 JWT with iss=VNL_ADS_JWT_ISSUER, aud=VNL_ADS_JWT_AUDIENCE,
 * sub=vnl-api, 5-minute TTL, shared symmetric secret.
 *
 * Transport hardening: configurable timeout (default 2000ms), one retry on
 * 5xx, graceful network failure → logged warn + default return.
 */

import { createHmac } from 'node:crypto';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { component: 'ad-service-client' } });

const DEFAULT_TIMEOUT_MS = 2000;
const JWT_TTL_SECONDS = 300; // 5min
const SERVICE_ACCOUNT_ID = 'vnl-api';

// ── Public types (exposed to handlers + web frontend) ───────────────────────

export interface DrawerItem {
  creativeId: string;
  type: 'promo' | 'product' | 'PROMO' | 'PRODUCT';
  thumbnail: string;
  title: string;
  durationMs: number;
}

/**
 * Overlay payload returned by POST /v1/trigger — embedded into IVS Timed
 * Metadata (broadcast) or `ad_overlay` chat event (hangout).
 *
 * `schemaVersion` drives client routing — unknown versions should be skipped.
 * `cta.clickResolveEndpoint` is always `/v1/click` today but exists so
 * vnl-ads can move the resolver without a vnl redeploy.
 */
export interface OverlayPayload {
  schemaVersion: number;
  type: string;
  cta?: {
    clickResolveEndpoint?: string;
    [key: string]: unknown;
  };
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
 * Returns false when the feature flag is off or required env vars are missing.
 * When false, every public fn in this module returns its safe default without
 * issuing a network call.
 */
export function adsEnabled(): boolean {
  if (process.env.VNL_ADS_FEATURE_ENABLED !== 'true') return false;
  const url = process.env.VNL_ADS_BASE_URL;
  const secret = process.env.VNL_ADS_JWT_SECRET;
  return !!url && !!secret && url.length > 0 && secret.length > 0;
}

function timeoutMs(): number {
  const raw = process.env.VNL_ADS_TIMEOUT_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
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
 * Claims match vnl-ads/docs/integration.md §1:
 *   iss=VNL_ADS_JWT_ISSUER (e.g. "vnl"), aud=VNL_ADS_JWT_AUDIENCE (e.g. "vnl-ads"),
 *   sub="vnl-api", iat, exp = iat + 300s.
 *
 * Exported for unit tests only — handlers should not call this directly.
 */
export function signServiceJwt(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const iss = process.env.VNL_ADS_JWT_ISSUER || 'vnl';
  const aud = process.env.VNL_ADS_JWT_AUDIENCE || 'vnl-ads';
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss,
    aud,
    sub: SERVICE_ACCOUNT_ID,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };
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
  const secret = process.env.VNL_ADS_JWT_SECRET!;
  const jwt = signServiceJwt(secret);
  const ms = timeoutMs();

  const doFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
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

  const base = process.env.VNL_ADS_BASE_URL!.replace(/\/$/, '');
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

  const base = process.env.VNL_ADS_BASE_URL!.replace(/\/$/, '');
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

  const base = process.env.VNL_ADS_BASE_URL!.replace(/\/$/, '');
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
