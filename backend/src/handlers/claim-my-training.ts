/**
 * POST /me/training-claim
 * Body: { creativeId: string, sessionId?: string }
 *
 * Passthrough to vnl-ads `POST /v1/training/claim`. Records that the caller
 * watched a training module. Server injects `userId` from the Cognito claim
 * so the caller can't claim on someone else's behalf.
 *
 * Feature-flag off → returns { overlayPayload: null, reason: 'ads_disabled' }.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AdsClient, AdsHttpError, AdsUnavailableError } from '@vnl/ads-client';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'claim-my-training' } });

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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  let body: { creativeId?: string; sessionId?: string; orgId?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  if (!body.creativeId || typeof body.creativeId !== 'string') {
    return resp(400, { error: 'creativeId required' });
  }

  const ads = getClient();
  if (!ads) return resp(200, { overlayPayload: null, reason: 'ads_disabled' });

  try {
    const result = await ads.claimTraining({
      userId,
      creativeId: body.creativeId,
      sessionId: body.sessionId,
      orgId: body.orgId ?? 'default',
    });
    return resp(200, result);
  } catch (err) {
    if (err instanceof AdsUnavailableError) {
      logger.warn('vnl-ads unavailable on training-claim', { userId, creativeId: body.creativeId });
      return resp(200, { overlayPayload: null, reason: 'ads_unavailable' });
    }
    if (err instanceof AdsHttpError) {
      logger.warn('vnl-ads non-2xx on training-claim', { userId, status: err.status, code: err.code });
      return resp(err.status >= 500 ? 502 : err.status, { error: err.code, message: err.message });
    }
    logger.error('training-claim unexpected error', { userId, error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal error' });
  }
};
