/**
 * POST /sessions/{sessionId}/captions/toggle handler
 * Enables or disables live captions on a session at runtime.
 * Only the session owner (broadcaster / host) can toggle.
 *
 * On success, updates the session METADATA row and emits a `captions_toggled`
 * chat event so connected viewers can immediately re-render their caption
 * overlay UI (show/hide).
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getIVSChatClient } from '../lib/ivs-clients';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getSessionById } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'toggle-captions' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  // 1. Extract actorId from Cognito claims
  const actorId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!actorId) {
    return resp(401, { error: 'Unauthorized' });
  }

  // 2. Extract sessionId from path parameters
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return resp(400, { error: 'sessionId required' });
  }

  // 3. Parse body for `enabled` boolean
  let enabled: unknown;
  try {
    const body = JSON.parse(event.body ?? '{}');
    enabled = body?.enabled;
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }

  if (typeof enabled !== 'boolean') {
    return resp(400, { error: 'enabled (boolean) required in request body' });
  }

  // 4. Load session for ownership check + chatRoom lookup
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return resp(404, { error: 'Session not found' });
  }

  if (actorId !== session.userId) {
    return resp(403, { error: 'Only the session owner can toggle captions' });
  }

  // 5. Persist the flag on the METADATA row
  await getDocumentClient().send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #captionsEnabled = :val',
      ExpressionAttributeNames: { '#captionsEnabled': 'captionsEnabled' },
      ExpressionAttributeValues: { ':val': enabled },
    })
  );

  // 6. Emit chat event so viewers can show/hide the caption overlay.
  //    Best-effort — mirrors the bounce-user pattern; never fatal.
  if (session.claimedResources?.chatRoom) {
    try {
      await getIVSChatClient().send(
        new SendEventCommand({
          roomIdentifier: session.claimedResources.chatRoom,
          eventName: 'captions_toggled',
          attributes: {
            enabled: String(enabled),
            actorId,
          },
        })
      );
    } catch (err) {
      logger.warn('SendEvent (captions_toggled) failed — continuing', {
        sessionId,
        enabled,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return resp(200, { message: 'Captions toggled', enabled });
};
