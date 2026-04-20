/**
 * Synth proxy — shields the vnl-ads SSM secret from the browser.
 *
 *   POST /admin/ads/synth          body: { text, voice, engine?, languageCode?, backdrop }
 *     Mints a forward-direction vnl → vnl-ads JWT, POSTs to
 *     {VNL_ADS_BASE_URL}/v1/synth/announcement, returns { synthesisId, expiresAt }
 *
 *   GET  /admin/ads/synth/{synthesisId}
 *     Mints a fresh JWT, GETs {VNL_ADS_BASE_URL}/v1/synth/announcement/{id},
 *     returns { state, mediaUrl?, thumbnailUrl?, durationSec?, contentHash?, expiresAt }
 *
 * Single handler dispatched on event.httpMethod. Both routes are admin-only.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { mintServiceToken } from '@vnl/ads-client';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { resolveSharedSecret } from '../lib/ads-service-auth';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-ads-synth' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

const JWT_TTL_SECONDS = 5 * 60;

function resp(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

async function mintOutgoingJwt(adminId: string): Promise<string | null> {
  const secret = await resolveSharedSecret();
  if (!secret) return null;
  const issuer = process.env.VNL_ADS_JWT_ISSUER || 'vnl';
  const audience = process.env.VNL_ADS_JWT_AUDIENCE || 'vnl-ads';
  return mintServiceToken({
    secret,
    issuer,
    audience,
    sub: adminId,
    ttlSeconds: JWT_TTL_SECONDS,
  });
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });
  const adminId = getAdminUserId(event) ?? 'admin';

  const baseUrl = process.env.VNL_ADS_BASE_URL;
  if (!baseUrl) return resp(503, { error: 'vnl-ads base URL not configured' });

  const token = await mintOutgoingJwt(adminId);
  if (!token) return resp(503, { error: 'vnl-ads signing secret not configured' });

  const method = event.httpMethod?.toUpperCase();

  if (method === 'POST') {
    const body = event.body ?? '{}';
    try {
      const parsed = JSON.parse(body);
      // Light client-side validation — server enforces cap of 1000 chars
      if (typeof parsed?.text !== 'string' || !parsed.text.trim()) {
        return resp(400, { error: 'text is required' });
      }
      if (parsed.text.length > 1000) {
        return resp(400, { error: 'text must be ≤ 1000 chars' });
      }
    } catch {
      return resp(400, { error: 'Invalid JSON body' });
    }

    const upstream = await fetch(`${baseUrl}/v1/synth/announcement`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
    });
    const payload = await upstream.text();
    if (upstream.status >= 500) {
      logger.warn('vnl-ads synth POST 5xx', { status: upstream.status, body: payload.slice(0, 300) });
    }
    return {
      statusCode: upstream.status,
      headers: CORS,
      body: payload,
    };
  }

  if (method === 'GET') {
    const synthesisId = event.pathParameters?.synthesisId;
    if (!synthesisId) return resp(400, { error: 'synthesisId is required' });

    const upstream = await fetch(
      `${baseUrl}/v1/synth/announcement/${encodeURIComponent(synthesisId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const payload = await upstream.text();
    if (upstream.status >= 500) {
      logger.warn('vnl-ads synth GET 5xx', { status: upstream.status, synthesisId });
    }
    return {
      statusCode: upstream.status,
      headers: CORS,
      body: payload,
    };
  }

  return resp(405, { error: 'Method not allowed' });
}
