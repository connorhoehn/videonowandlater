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
  type CreatorPayouts,
  type CreatorImpressionSeries,
  type GetPayoutsOptions,
  type GetImpressionSeriesOptions,
  type TrainingDueResponse,
  type TrainingClaimRequest,
  type TrainingClaimResponse,
} from '@vnl/ads-client';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { component: 'ad-service-client' } });
const metrics = new Metrics({ namespace: 'VNL/Ads', serviceName: 'ad-service-client' });

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

/** Outcome of a trigger call including the new v0.3 `reason` field. */
export interface TriggerAdOutcome {
  overlayPayload: OverlayPayload | null;
  /** v0.3+: non-null when overlayPayload is null and the service explained why. */
  reason?: 'cap_reached' | 'schedule_out_of_window' | 'no_creative' | string;
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
    onCall: (ev) => {
      // Emit one EMF metric line per SDK call for CloudWatch dashboards.
      // Dimensions kept minimal (path + status bucket) to stay under EMF's
      // 30-metrics-per-line limit and to keep Metric Explorer cardinality sane.
      try {
        metrics.addDimension('path', ev.path);
        const statusBucket =
          typeof ev.status === 'number'
            ? ev.status >= 500 ? '5xx'
            : ev.status >= 400 ? '4xx'
            : '2xx'
            : ev.status;
        metrics.addDimension('status', String(statusBucket));
        metrics.addMetric('AdServiceCall', MetricUnit.Count, 1);
        metrics.addMetric('AdServiceLatencyMs', MetricUnit.Milliseconds, ev.durationMs);
        metrics.publishStoredMetrics();
      } catch {
        /* metrics are best-effort */
      }
    },
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

export async function triggerAd(input: TriggerAdInput): Promise<TriggerAdOutcome> {
  const client = getClient();
  if (!client) return { overlayPayload: null };

  try {
    const body: TriggerRequest = {
      creativeId: input.creativeId,
      sessionId: input.sessionId,
      creatorId: input.creatorId,
      triggerType: input.triggerType,
    };
    const res = (await client.trigger(body)) as {
      overlayPayload?: OverlayPayload | null;
      reason?: string;
    };
    return {
      overlayPayload: res?.overlayPayload ?? null,
      reason: res?.reason,
    };
  } catch (err) {
    logFailure('trigger', { sessionId: input.sessionId, creativeId: input.creativeId }, err);
    return { overlayPayload: null };
  }
}

/**
 * POST /v1/sessions/{sessionId}/start — tells vnl-ads a creator just went LIVE.
 * Fire-and-forget; vnl-ads uses this to know which sessions are eligible for
 * scheduled campaign triggers. Idempotent on the vnl-ads side.
 */
export async function startAdsSession(sessionId: string, creatorId: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.startSession(sessionId, { creatorId });
  } catch (err) {
    logFailure('startSession', { sessionId, creatorId }, err);
  }
}

/**
 * POST /v1/sessions/{sessionId}/end — tells vnl-ads a session is done so the
 * scheduler stops firing triggers into it. Fire-and-forget; idempotent.
 */
export async function endAdsSession(sessionId: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.endSession(sessionId);
  } catch (err) {
    logFailure('endSession', { sessionId }, err);
  }
}

// ── v0.3 creator analytics + training passthroughs ─────────────────────────

const EMPTY_PAYOUTS: CreatorPayouts = {
  creatorId: '',
  totalCents: 0,
  items: [],
};

const EMPTY_IMPRESSION_SERIES: CreatorImpressionSeries = {
  creatorId: '',
  from: new Date(0).toISOString(),
  to: new Date(0).toISOString(),
  granularity: 'day',
  points: [],
};

export async function getPayouts(
  userId: string,
  opts?: GetPayoutsOptions,
): Promise<CreatorPayouts> {
  const client = getClient();
  if (!client) return EMPTY_PAYOUTS;
  try {
    return await client.getPayouts(userId, opts);
  } catch (err) {
    logFailure('getPayouts', { userId }, err);
    return EMPTY_PAYOUTS;
  }
}

export async function getCreatorImpressionSeries(
  userId: string,
  opts: GetImpressionSeriesOptions,
): Promise<CreatorImpressionSeries> {
  const client = getClient();
  if (!client) return EMPTY_IMPRESSION_SERIES;
  try {
    return await client.getCreatorImpressionSeries(userId, opts);
  } catch (err) {
    logFailure('getCreatorImpressionSeries', { userId }, err);
    return EMPTY_IMPRESSION_SERIES;
  }
}

export async function getTrainingDue(
  userId: string,
  limit?: number,
): Promise<TrainingDueResponse> {
  const client = getClient();
  if (!client) return { userId, items: [] };
  try {
    return await client.getTrainingDue(userId, limit);
  } catch (err) {
    logFailure('getTrainingDue', { userId }, err);
    return { userId, items: [] };
  }
}

/**
 * Claim training — unlike the other passthroughs, we throw back discriminable
 * errors so the handler can differentiate ads_unavailable (200 with reason)
 * from ads_http_error (propagate status). Callers get either the success
 * shape or one of the two error classes.
 */
export async function claimTraining(
  body: TrainingClaimRequest,
): Promise<TrainingClaimResponse | { overlayPayload: null; reason: 'ads_disabled' | 'ads_unavailable' }> {
  const client = getClient();
  if (!client) return { overlayPayload: null, reason: 'ads_disabled' };
  try {
    return await client.claimTraining(body);
  } catch (err) {
    if (err instanceof AdsUnavailableError) {
      logFailure('claimTraining', { creativeId: body.creativeId }, err);
      return { overlayPayload: null, reason: 'ads_unavailable' };
    }
    // Rethrow AdsHttpError / unknown — handler surfaces status codes.
    throw err;
  }
}

export { AdsHttpError, AdsUnavailableError };

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
