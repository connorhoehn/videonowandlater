/**
 * POST /admin/ads/mint-token
 *
 * Mints a short-lived HS256 bearer token so the embedded vnl-ads admin UI
 * (React component library) can call vnl-ads directly. Keeps the shared
 * secret server-side — the browser never sees it.
 *
 * Response: { token: string, expiresAt: ISO string }
 * Gated on isAdmin(). TTL 15min.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { mintServiceToken } from '@vnl/ads-client';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { resolveSharedSecret } from '../lib/ads-service-auth';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-admin', persistentKeys: { handler: 'admin-mint-ads-token' } });

const TTL_SECONDS = 15 * 60;

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (!isAdmin(event)) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let secret: string | undefined;
  try {
    secret = await resolveSharedSecret();
  } catch (err) {
    logger.error('failed to resolve ads shared secret', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'Ads service not configured' }) };
  }
  if (!secret) {
    logger.error('ads shared secret not configured');
    return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'Ads service not configured' }) };
  }

  const actorId = getAdminUserId(event) ?? 'admin';
  const issuer = process.env.VNL_ADS_JWT_ISSUER || 'vnl';
  const audience = process.env.VNL_ADS_ADMIN_JWT_AUDIENCE || 'vnl-ads-admin';

  const token = mintServiceToken({
    secret,
    issuer,
    audience,
    sub: actorId,
    ttlSeconds: TTL_SECONDS,
  });
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

  logger.info('Minted ads admin token', { actorId, audience });

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ token, expiresAt }),
  };
};
