/**
 * Verifies reverse-direction service JWTs from vnl-ads to vnl.
 * Expected claims: iss=vnl-ads, aud=vnl, signed HS256 with SERVICE_JWT_SECRET.
 *
 * Secret resolution order:
 *   1. VNL_ADS_JWT_SECRET_PARAM → fetched from SSM SecureString, cached in module scope
 *   2. VNL_ADS_JWT_SECRET       → raw value (tests + local dev only; never used in prod)
 */

import jwt from 'jsonwebtoken';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export interface VerifyResult {
  ok: true;
  sub: string;
}

export interface VerifyError {
  ok: false;
  status: 401 | 503;
  error: string;
}

let ssmClient: SSMClient | undefined;
let cachedSecret: string | undefined;

function getSsmClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient({});
  }
  return ssmClient;
}

/**
 * Reads the shared HS256 secret used for both directions of vnl ↔ vnl-ads
 * service JWTs. Cached in module scope so subsequent calls are free.
 *
 * Used by the verifier here (incoming vnl-ads → vnl) and by the synth proxy
 * handlers (outgoing vnl → vnl-ads) that need to mint tokens.
 */
export async function resolveSharedSecret(): Promise<string | undefined> {
  return resolveSecret();
}

async function resolveSecret(): Promise<string | undefined> {
  if (cachedSecret) return cachedSecret;

  const paramName = process.env.VNL_ADS_JWT_SECRET_PARAM;
  if (paramName) {
    const res = await getSsmClient().send(
      new GetParameterCommand({ Name: paramName, WithDecryption: true }),
    );
    const value = res.Parameter?.Value;
    if (value) {
      cachedSecret = value;
      return cachedSecret;
    }
  }

  // Fallback for tests + local dev. Production always uses the SSM path above.
  const raw = process.env.VNL_ADS_JWT_SECRET;
  if (raw) {
    cachedSecret = raw;
    return cachedSecret;
  }

  return undefined;
}

/** Resets the in-memory secret cache. Test-only. */
export function __resetAdsAuthCache(): void {
  cachedSecret = undefined;
  ssmClient = undefined;
}

function getBearerToken(event: APIGatewayProxyEvent): string | null {
  const header = event.headers?.Authorization ?? event.headers?.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

export async function verifyAdsServiceToken(event: APIGatewayProxyEvent): Promise<VerifyResult | VerifyError> {
  let secret: string | undefined;
  try {
    secret = await resolveSecret();
  } catch {
    return { ok: false, status: 503, error: 'Ads service not configured' };
  }
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
