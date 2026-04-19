/**
 * Verifies reverse-direction service JWTs from vnl-ads to vnl.
 * Expected claims: iss=vnl-ads, aud=vnl, signed HS256 with SERVICE_JWT_SECRET.
 */

import jwt from 'jsonwebtoken';
import type { APIGatewayProxyEvent } from 'aws-lambda';

export interface VerifyResult {
  ok: true;
  sub: string;
}

export interface VerifyError {
  ok: false;
  status: 401 | 503;
  error: string;
}

function getBearerToken(event: APIGatewayProxyEvent): string | null {
  const header = event.headers?.Authorization ?? event.headers?.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

export function verifyAdsServiceToken(event: APIGatewayProxyEvent): VerifyResult | VerifyError {
  const secret = process.env.VNL_ADS_JWT_SECRET;
  if (!secret) {
    return { ok: false, status: 503, error: 'Ads service not configured' };
  }

  const token = getBearerToken(event);
  if (!token) {
    return { ok: false, status: 401, error: 'Missing bearer token' };
  }

  const expectedIssuer = process.env.VNL_SERVICE_JWT_INCOMING_ISSUER || 'vnl-ads';
  const expectedAudience = process.env.VNL_SERVICE_JWT_INCOMING_AUDIENCE || 'vnl';

  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: expectedIssuer,
      audience: expectedAudience,
    });
    const sub = typeof decoded === 'object' && decoded !== null ? String(decoded.sub ?? '') : '';
    return { ok: true, sub };
  } catch {
    return { ok: false, status: 401, error: 'Invalid token' };
  }
}
