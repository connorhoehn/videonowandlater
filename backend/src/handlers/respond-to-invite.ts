/**
 * POST /invites/{sessionId}/respond
 *
 * Body: { action: 'accept' | 'decline' }
 *
 * The invited user marks their intent. This only updates the INVITE row
 * status — it does not automatically join the session. The client is
 * expected to call /sessions/{sessionId}/join after an accept.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import { updateInviteStatus } from '../repositories/invitation-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'respond-to-invite' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  let body: { action?: string } = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return resp(400, { error: 'Invalid JSON body' });
    }
  }

  const action = body.action;
  if (action !== 'accept' && action !== 'decline') {
    return resp(400, {
      error: "action must be 'accept' or 'decline'",
    });
  }

  try {
    const { userId } = await identify(event);
    const newStatus = action === 'accept' ? 'accepted' : 'declined';

    const updated = await updateInviteStatus(
      tableName,
      userId,
      sessionId,
      newStatus,
    );
    if (!updated) {
      return resp(404, { error: 'Invitation not found' });
    }

    logger.info('Invitation responded', { sessionId, userId, action });
    return resp(200, { invitation: updated });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('respond-to-invite failed', {
      error: err instanceof Error ? err.message : String(err),
      sessionId,
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
