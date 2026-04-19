/**
 * Session ownership / authorization helpers.
 *
 * Intentionally separate from `lib/authz.ts` (the CASL-based one from Phase 1)
 * because session ownership is a narrower, simpler check that doesn't need
 * full CASL Ability construction.
 */

import type { APIGatewayProxyResult } from 'aws-lambda';
import type { Session } from '../domain/session';
import { isAdmin } from './admin-auth';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { resp } from './http';

/**
 * Result of an authorization check. When not authorized, `response` holds
 * the APIGatewayProxyResult the handler should return immediately.
 */
export type AuthzResult =
  | { ok: true }
  | { ok: false; response: APIGatewayProxyResult };

/**
 * Require that the caller is the session owner OR an admin.
 * Returns an immediate 403 response on failure.
 *
 * Usage:
 *   const check = requireSessionOwnerOrAdmin(session, actorId, event);
 *   if (!check.ok) return check.response;
 */
export function requireSessionOwnerOrAdmin(
  session: Pick<Session, 'userId'>,
  actorId: string,
  event: APIGatewayProxyEvent,
): AuthzResult {
  if (session.userId === actorId) return { ok: true };
  if (isAdmin(event)) return { ok: true };
  return {
    ok: false,
    response: resp(403, { error: 'Forbidden: not the session owner' }),
  };
}

/**
 * Stricter variant: only the session owner. Admin does not suffice.
 * Used for destructive ops (rename, delete) where admin override isn't appropriate.
 */
export function requireSessionOwner(
  session: Pick<Session, 'userId'>,
  actorId: string,
): AuthzResult {
  if (session.userId === actorId) return { ok: true };
  return {
    ok: false,
    response: resp(403, { error: 'Forbidden: only the session owner can perform this action' }),
  };
}
