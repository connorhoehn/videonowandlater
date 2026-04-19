/**
 * Shared HTTP helpers for Lambda handlers.
 *
 * Goal: deduplicate the CORS + resp() + JWT claim + body-parse patterns that
 * were copied into ~80 handlers across the parallel phase-1-5 ships.
 *
 * Legacy handlers (pre-refactor) still inline their own `CORS` + `resp()` —
 * leave them alone. New / touched handlers should import from here.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

/** Build an API Gateway response with CORS + JSON body. */
export function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Thrown when an auth claim is missing. Handlers can `try { requireUserId(event) } catch (e) { if (e instanceof UnauthorizedError) ... }`
 * or use `getUserId(event)` for the non-throwing variant.
 */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Non-throwing: return the Cognito username or undefined. */
export function getUserId(event: APIGatewayProxyEvent): string | undefined {
  const claim = event.requestContext?.authorizer?.claims?.['cognito:username'];
  return typeof claim === 'string' && claim.length > 0 ? claim : undefined;
}

/** Throwing: return the Cognito username; throws UnauthorizedError if missing. */
export function requireUserId(event: APIGatewayProxyEvent): string {
  const id = getUserId(event);
  if (!id) throw new UnauthorizedError();
  return id;
}

/**
 * Parse an API Gateway JSON body safely.
 *   success → { ok: true, data }
 *   invalid → { ok: false, response: <400 APIGatewayProxyResult> }
 *
 * Returns a 400 APIGatewayProxyResult in the error case so handlers can
 * `if (!parsed.ok) return parsed.response;` without duplicating the try/catch.
 *
 * Treats a null body as `{}` (common for GET-to-POST adapters). If you need
 * to reject empty bodies, check `Object.keys(parsed.data).length === 0`.
 */
export function parseJsonBody<T = Record<string, unknown>>(
  event: APIGatewayProxyEvent,
): { ok: true; data: T } | { ok: false; response: APIGatewayProxyResult } {
  try {
    const data = JSON.parse(event.body ?? '{}') as T;
    return { ok: true, data };
  } catch {
    return { ok: false, response: resp(400, { error: 'Invalid JSON' }) };
  }
}

/**
 * Map UnauthorizedError → 401 response. Other errors re-throw for caller
 * to log and return 500.
 *
 * Usage:
 *   try {
 *     const userId = requireUserId(event);
 *     ...
 *   } catch (err) {
 *     const mapped = mapKnownError(err);
 *     if (mapped) return mapped;
 *     throw err;
 *   }
 */
export function mapKnownError(err: unknown): APIGatewayProxyResult | null {
  if (err instanceof UnauthorizedError) {
    return resp(401, { error: err.message });
  }
  return null;
}
