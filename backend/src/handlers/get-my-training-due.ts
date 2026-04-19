/**
 * GET /me/training-due?limit=1
 *
 * Passthrough to vnl-ads `GET /v1/users/{userId}/training-due`. Returns
 * assignments the caller hasn't yet watched, oldest first. Scoped to the
 * caller's own userId — creators can't peek at anyone else's.
 *
 * Feature-flag off → returns empty items.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AdsClient, AdsHttpError, AdsUnavailableError } from '@vnl/ads-client';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-my-training-due' } });

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
    timeoutMs: 2000,
    enabled: true,
  });
  return client;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const ads = getClient();
  if (!ads) return resp(200, { userId, items: [] });

  const limitRaw = event.queryStringParameters?.limit;
  const limit = limitRaw ? Math.max(1, Math.min(10, parseInt(limitRaw, 10) || 1)) : 1;

  try {
    const result = await ads.getTrainingDue(userId, limit);
    return resp(200, result);
  } catch (err) {
    if (err instanceof AdsUnavailableError) {
      logger.warn('vnl-ads unavailable', { userId, message: err.message });
    } else if (err instanceof AdsHttpError) {
      logger.warn('vnl-ads non-2xx on training-due', { userId, status: err.status });
    } else {
      logger.warn('training-due unexpected error', { userId, error: err instanceof Error ? err.message : String(err) });
    }
    return resp(200, { userId, items: [] });
  }
};
