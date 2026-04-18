/**
 * GET /sessions/{sessionId}/lobby
 *
 * Lists lobby requests for the session owner (or admin). Used by the host's
 * LobbyPanel to show pending approval requests.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById, listLobbyRequests } from '../repositories/session-repository';
import { SessionType } from '../domain/session';
import { isAdmin } from '../lib/admin-auth';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const actorId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!actorId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  const session = await getSessionById(tableName, sessionId);
  if (!session) return resp(404, { error: 'Session not found' });
  if (session.sessionType !== SessionType.HANGOUT) {
    return resp(400, { error: 'Session is not a HANGOUT' });
  }

  // Authz: session owner OR admin
  if (actorId !== session.userId && !isAdmin(event)) {
    return resp(403, { error: 'Only the session owner can view lobby requests' });
  }

  const requests = await listLobbyRequests(tableName, sessionId);

  // Return only pending by default — host UI can filter further
  const pending = requests.filter(r => r.status === 'pending');

  return resp(200, { requests: pending, all: requests });
}
