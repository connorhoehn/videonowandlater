/**
 * GET /me/impression-series?from=<ISO>&to=<ISO>&granularity=day
 *
 * Passthrough to vnl-ads `GET /v1/creators/{userId}/impressions` — time-series
 * impression counts for charting. Defaults to last 30 days at day granularity.
 *
 * Feature-flag off → returns empty series.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AdsClient, AdsHttpError, AdsUnavailableError } from '@vnl/ads-client';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-my-impression-series' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function adsEnabled(): boolean {
  if (process.env.VNL_ADS_FEATURE_ENABLED !== 'true') return false;
  return !!process.env.VNL_ADS_BASE_URL && !!process.env.VNL_ADS_JWT_SECRET;
}

let client: AdsClient | null = null;
function getClient(): AdsClient | null {
  if (!adsEnabled()) return null;
  if (client) return client;
  client = new AdsClient({
    baseUrl: process.env.VNL_ADS_BASE_URL!,
    jwtSecret: process.env.VNL_ADS_JWT_SECRET!,
    jwtIssuer: process.env.VNL_ADS_JWT_ISSUER || 'vnl',
    jwtAudience: process.env.VNL_ADS_JWT_AUDIENCE || 'vnl-ads',
    serviceSub: 'vnl-api',
    timeoutMs: 3000,
    enabled: true,
  });
  return client;
}

const EMPTY = { series: [], from: null, to: null, granularity: 'day' };

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const ads = getClient();
  if (!ads) return resp(200, EMPTY);

  const q = event.queryStringParameters ?? {};
  const granularity = q.granularity === 'hour' ? 'hour' : 'day';
  const to = q.to ?? new Date().toISOString();
  const from = q.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = await ads.getCreatorImpressionSeries(userId, { from, to, granularity });
    return resp(200, result);
  } catch (err) {
    if (err instanceof AdsUnavailableError) {
      logger.warn('vnl-ads unavailable', { userId, message: err.message });
    } else if (err instanceof AdsHttpError) {
      logger.warn('vnl-ads non-2xx on impression series', { userId, status: err.status, code: err.code });
    } else {
      logger.warn('impression series unexpected error', { userId, error: err instanceof Error ? err.message : String(err) });
    }
    return resp(200, EMPTY);
  }
};
