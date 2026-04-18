/**
 * Cognito Pre Token Generation trigger.
 *
 * Injects:
 *   - custom:role    — 'admin' | 'moderator' | 'user' (derived from Cognito groups)
 *   - permVersion    — bumps to invalidate old ability caches client-side
 *
 * Idempotent and defensive: if the event shape is unexpected we log and
 * return the event untouched so auth never breaks on a malformed trigger.
 */

import type { PreTokenGenerationTriggerHandler } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({
  serviceName: 'vnl-auth',
  persistentKeys: { handler: 'pre-token' },
});

const PERM_VERSION = '1';

function deriveRole(groups: string[] | undefined): 'admin' | 'moderator' | 'user' {
  if (!Array.isArray(groups)) return 'user';
  if (groups.includes('admin')) return 'admin';
  if (groups.includes('moderator')) return 'moderator';
  return 'user';
}

export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  try {
    const groups = event.request?.groupConfiguration?.groupsToOverride ?? [];
    const role = deriveRole(groups);

    // Defensive: ensure claimsOverrideDetails + claimsToAddOrOverride exist.
    event.response = event.response ?? ({} as any);
    event.response.claimsOverrideDetails =
      event.response.claimsOverrideDetails ?? ({} as any);
    event.response.claimsOverrideDetails.claimsToAddOrOverride = {
      ...(event.response.claimsOverrideDetails.claimsToAddOrOverride ?? {}),
      'custom:role': role,
      permVersion: PERM_VERSION,
    };

    logger.info('Injected role claim', {
      username: event.userName,
      role,
      groupsCount: groups.length,
    });
  } catch (err) {
    // Never block token issuance on our claim-injection logic.
    logger.error('Pre-token trigger failed (returning event untouched)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return event;
};
