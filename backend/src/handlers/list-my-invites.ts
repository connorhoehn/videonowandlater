/**
 * GET /invites/mine?status=pending
 *
 * Lists the caller's session invites joined with minimal session metadata
 * (sessionId, sessionType, hostUserId, createdAt). Any authenticated user may
 * call this. Optional ?status filter: pending | accepted | declined.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import {
  listInvitesForUser,
  type InvitationStatus,
} from '../repositories/invitation-repository';
import { getSessionById } from '../repositories/session-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'list-my-invites' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const VALID_STATUSES: InvitationStatus[] = ['pending', 'accepted', 'declined'];

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const rawStatus = event.queryStringParameters?.status;
  let status: InvitationStatus | undefined;
  if (rawStatus) {
    if (!VALID_STATUSES.includes(rawStatus as InvitationStatus)) {
      return resp(400, {
        error: `invalid status (expected one of: ${VALID_STATUSES.join(', ')})`,
      });
    }
    status = rawStatus as InvitationStatus;
  }

  try {
    const { userId } = await identify(event);
    const invites = await listInvitesForUser(tableName, userId, { status });

    // Enrich each invite with minimal session metadata.
    const enriched = await Promise.all(
      invites.map(async (inv) => {
        try {
          const session = await getSessionById(tableName, inv.sessionId);
          return {
            ...inv,
            session: session
              ? {
                  sessionId: session.sessionId,
                  sessionType: session.sessionType,
                  hostUserId: session.userId,
                  createdAt: session.createdAt,
                  status: session.status,
                }
              : null,
          };
        } catch {
          return { ...inv, session: null };
        }
      }),
    );

    return resp(200, { invites: enriched });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('list-my-invites failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
