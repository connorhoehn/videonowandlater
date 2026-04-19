/**
 * ad-service-client — thin wrapper around `@vnl/ads-client` (SDK published by
 * the sibling vnl-ads service). Centralizes AdsClient construction so handlers
 * don't re-read env vars on every call and don't need to catch SDK-specific
 * error classes.
 *
 * Failure policy: SDK throws `AdsUnavailableError` on network/timeout/breaker,
 * `AdsHttpError` on 4xx/5xx. We catch both and return safe defaults — the
 * handlers never surface vnl-ads failures to end users.
 */

import {
  AdsClient,
  AdsHttpError,
  AdsUnavailableError,
  type DrawerResponse,
  type TriggerRequest,
  type TriggerResponse,
  type ClickRequest,
  type ClickResponse,
} from '@vnl/ads-client';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { component: 'ad-service-client' } });

// ── Re-exported types (kept for handler/test ergonomics) ───────────────────

export type DrawerItem = DrawerResponse['items'][number];
export type { TriggerRequest, TriggerResponse, ClickRequest, ClickResponse };

/**
 * Overlay payload shape embedded into IVS Timed Metadata or chat events.
 * `schemaVersion` drives client routing — unknown versions must be skipped.
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

export function adsEnabled(): boolean {
  if (process.env.VNL_ADS_FEATURE_ENABLED !== 'true') return false;
  const url = process.env.VNL_ADS_BASE_URL;
  const secret = process.env.VNL_ADS_JWT_SECRET;
  return !!url && !!secret && url.length > 0 && secret.length > 0;
}

// ── Singleton AdsClient ─────────────────────────────────────────────────────

let clientInstance: AdsClient | null = null;

function getClient(): AdsClient | null {
  if (!adsEnabled()) return null;
  if (clientInstance) return clientInstance;

  const timeoutRaw = process.env.VNL_ADS_TIMEOUT_MS;
  const timeoutMs = timeoutRaw && !Number.isNaN(parseInt(timeoutRaw, 10))
    ? parseInt(timeoutRaw, 10)
    : 2000;

  clientInstance = new AdsClient({
    baseUrl: process.env.VNL_ADS_BASE_URL!,
    jwtSecret: process.env.VNL_ADS_JWT_SECRET!,
    jwtIssuer: process.env.VNL_ADS_JWT_ISSUER || 'vnl',
    jwtAudience: process.env.VNL_ADS_JWT_AUDIENCE || 'vnl-ads',
    serviceSub: 'vnl-api',
    timeoutMs,
    enabled: true,
  });
  return clientInstance;
}

/** Reset singleton — for test isolation only. */
export function __resetClientForTests(): void {
  clientInstance = null;
}

function logFailure(op: string, ctx: Record<string, unknown>, err: unknown): void {
  if (err instanceof AdsUnavailableError) {
    logger.warn(`vnl-ads unavailable on ${op}`, { ...ctx, message: err.message });
  } else if (err instanceof AdsHttpError) {
    logger.warn(`vnl-ads non-2xx on ${op}`, { ...ctx, status: err.status, code: err.code });
  } else {
    logger.warn(`vnl-ads ${op} unexpected error`, {
      ...ctx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getDrawer(userId: string, sessionId: string): Promise<DrawerItem[]> {
  const client = getClient();
  if (!client) return [];

  try {
    const res = await client.getDrawer(userId, sessionId);
    return Array.isArray(res?.items) ? res.items : [];
  } catch (err) {
    logFailure('getDrawer', { userId, sessionId }, err);
    return [];
  }
}

export async function triggerAd(input: TriggerAdInput): Promise<OverlayPayload | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const body: TriggerRequest = {
      creativeId: input.creativeId,
      sessionId: input.sessionId,
      creatorId: input.creatorId,
      triggerType: input.triggerType,
    };
    const res: TriggerResponse = await client.trigger(body);
    const payload = (res as { overlayPayload?: OverlayPayload })?.overlayPayload;
    return payload ?? null;
  } catch (err) {
    logFailure('trigger', { sessionId: input.sessionId, creativeId: input.creativeId }, err);
    return null;
  }
}

export async function trackClick(input: TrackClickInput): Promise<{ ctaUrl: string } | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const body: ClickRequest = {
      creativeId: input.creativeId,
      sessionId: input.sessionId,
      viewerId: input.viewerId,
    };
    const res: ClickResponse = await client.click(body);
    const ctaUrl = (res as { ctaUrl?: string })?.ctaUrl;
    return ctaUrl ? { ctaUrl } : null;
  } catch (err) {
    logFailure('trackClick', { sessionId: input.sessionId, creativeId: input.creativeId }, err);
    return null;
  }
}
