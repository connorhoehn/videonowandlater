import type { APIGatewayProxyEvent } from 'aws-lambda';
import { defineAbilityFor, roleFromCognitoGroups } from './abilities';

/**
 * Returns true when the caller can `manage all` — i.e., the CASL "admin" role.
 *
 * Kept as a sugar wrapper over CASL so existing admin handlers don't break.
 * New code should prefer `authorize()` from `./authz` for fine-grained checks.
 */
export function isAdmin(event: APIGatewayProxyEvent): boolean {
  const claims = event.requestContext?.authorizer?.claims;
  if (!claims) return false;

  const explicit = claims['custom:role'];
  const role =
    explicit === 'admin' || explicit === 'moderator' || explicit === 'user'
      ? explicit
      : roleFromCognitoGroups(claims['cognito:groups']);
  const userId =
    claims['cognito:username'] || claims['username'] || claims['sub'] || 'anon';

  const ability = defineAbilityFor({ userId, role });
  return ability.can('manage', 'all');
}

export function getAdminUserId(event: APIGatewayProxyEvent): string | undefined {
  return event.requestContext?.authorizer?.claims?.['cognito:username'];
}
