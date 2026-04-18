/**
 * Authorization middleware built on CASL abilities.
 *
 * `authorize(event, action, subject, resource?)` returns
 *   { userId, role, ability }
 * or throws a `ForbiddenError` / `UnauthorizedError`.
 *
 * Compatible with both API Gateway Cognito authorizer claims (the normal
 * HTTP path) and raw bearer tokens (useful for local / tool integrations),
 * via `aws-jwt-verify` against USER_POOL_ID + USER_POOL_CLIENT_ID.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  defineAbilityFor,
  roleFromCognitoGroups,
  type AppAbility,
  type AppActions,
  type AppRole,
  type AppSubjects,
  type GroupRole,
} from './abilities';

export class ForbiddenError extends Error {
  statusCode = 403;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends Error {
  statusCode = 401;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export interface AuthzResult {
  userId: string;
  role: AppRole;
  ability: AppAbility;
  claims: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

let verifierSingleton: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> | null {
  const userPoolId = process.env.USER_POOL_ID;
  const clientId = process.env.USER_POOL_CLIENT_ID;
  if (!userPoolId || !clientId) return null;
  if (!verifierSingleton) {
    verifierSingleton = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'id',
      clientId,
    });
  }
  return verifierSingleton;
}

async function extractClaims(event: APIGatewayProxyEvent): Promise<Record<string, any>> {
  // Preferred: API Gateway has already validated and injected claims.
  const apiGwClaims = event.requestContext?.authorizer?.claims;
  if (apiGwClaims && Object.keys(apiGwClaims).length > 0) {
    return apiGwClaims as Record<string, any>;
  }

  // Fallback: verify raw bearer token. (Used only when the Cognito authorizer
  // isn't in front of the Lambda — e.g., local dev or cross-service calls.)
  const authHeader =
    event.headers?.Authorization || event.headers?.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    throw new UnauthorizedError('Missing bearer token');
  }

  const verifier = getVerifier();
  if (!verifier) {
    throw new UnauthorizedError('JWT verification is not configured');
  }

  try {
    const payload = await verifier.verify(match[1]);
    return payload as unknown as Record<string, any>;
  } catch (err) {
    throw new UnauthorizedError(
      `Invalid token: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function extractUserId(claims: Record<string, any>): string {
  return (
    claims['cognito:username'] ||
    claims['username'] ||
    claims['sub'] ||
    ''
  );
}

function extractRole(claims: Record<string, any>): AppRole {
  // Prefer explicit custom claim injected by pre-token-generation Lambda.
  const explicit = claims['custom:role'];
  if (explicit === 'admin' || explicit === 'moderator' || explicit === 'user') {
    return explicit;
  }
  return roleFromCognitoGroups(claims['cognito:groups']);
}

// ---------------------------------------------------------------------------
// Core entrypoint
// ---------------------------------------------------------------------------

export interface AuthorizeOptions {
  /** Optional map of groupId → groupRole for this user's memberships. */
  groupMemberships?: Record<string, GroupRole>;
}

/**
 * Authorize a request. Throws ForbiddenError when the caller can't perform
 * `action` on `subject` (or the specific `resource` if given).
 */
export async function authorize(
  event: APIGatewayProxyEvent,
  action: AppActions,
  subject: AppSubjects,
  resource?: unknown,
  options?: AuthorizeOptions,
): Promise<AuthzResult> {
  const claims = await extractClaims(event);
  const userId = extractUserId(claims);
  if (!userId) throw new UnauthorizedError('Missing user identity');

  const role = extractRole(claims);
  const ability = defineAbilityFor({
    userId,
    role,
    groupMemberships: options?.groupMemberships,
  });

  // For resource-scoped checks we tag the plain object with a subject type
  // using CASL's "detectSubjectType" via the `__caslSubjectType__` property.
  // If no resource is provided, this is a subject-type check.
  const target = resource
    ? Object.assign(
        Array.isArray(resource) ? [...(resource as unknown[])] : { ...(resource as object) },
        { __caslSubjectType__: subject },
      )
    : subject;

  if (!ability.can(action, target as any)) {
    throw new ForbiddenError(`Forbidden: cannot ${action} ${subject}`);
  }

  return { userId, role, ability, claims };
}

/**
 * Convert an auth-related error to an API Gateway response shape.
 * Returns null if the error isn't recognized as auth-related.
 *
 * Uses duck-typed `statusCode` so class-identity differences across modules
 * (e.g., ts-jest transforms) don't mask legitimate 401/403s.
 */
export function mapAuthError(
  err: unknown,
): { statusCode: number; message: string } | null {
  if (err instanceof UnauthorizedError) return { statusCode: 401, message: err.message };
  if (err instanceof ForbiddenError) return { statusCode: 403, message: err.message };
  const status = (err as any)?.statusCode;
  if (status === 401 || status === 403) {
    return { statusCode: status, message: (err as Error).message || 'Unauthorized' };
  }
  return null;
}

/**
 * Lightweight helper to just identify the caller (no permission check).
 * Useful for endpoints that allow all authenticated users.
 */
export async function identify(event: APIGatewayProxyEvent): Promise<AuthzResult> {
  const claims = await extractClaims(event);
  const userId = extractUserId(claims);
  if (!userId) throw new UnauthorizedError('Missing user identity');
  const role = extractRole(claims);
  const ability = defineAbilityFor({ userId, role });
  return { userId, role, ability, claims };
}
