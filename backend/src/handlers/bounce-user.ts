/**
 * POST /sessions/{sessionId}/bounce handler
 * Disconnects a user from IVS Chat and records a BOUNCE moderation event.
 * Only the session owner (broadcaster) can bounce users.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DisconnectUserCommand, SendEventCommand } from '@aws-sdk/client-ivschat';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getIVSChatClient } from '../lib/ivs-clients';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getSessionById } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'bounce-user' } });

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

  // 3. Parse body for target userId
  let targetUserId: string | undefined;
  try {
    const body = JSON.parse(event.body ?? '{}');
    targetUserId = body?.userId;
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }

  if (!targetUserId) {
    return resp(400, { error: 'userId required in request body' });
  }

  // 4. Load session
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return resp(404, { error: 'Session not found' });
  }

  // 5. Enforce ownership — only broadcaster can bounce
  if (actorId !== session.userId) {
    return resp(403, { error: 'Only the session owner can bounce users' });
  }

  // 6a. Emit a `user_kicked` chat event BEFORE disconnecting so remaining
  //     clients can render a kick banner / toast. Best-effort — never fatal.
  if (session.claimedResources?.chatRoom) {
    try {
      await getIVSChatClient().send(
        new SendEventCommand({
          roomIdentifier: session.claimedResources.chatRoom,
          eventName: 'user_kicked',
          attributes: {
            userId: targetUserId,
            reason: 'Removed by broadcaster',
            scope: 'session',
          },
        })
      );
    } catch (err) {
      logger.warn('SendEvent (user_kicked) failed — continuing', {
        sessionId,
        targetUserId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 6b. Disconnect user from IVS Chat (best-effort — catch ResourceNotFoundException)
  try {
    await getIVSChatClient().send(
      new DisconnectUserCommand({
        roomIdentifier: session.claimedResources.chatRoom,
        userId: targetUserId,
        reason: 'Removed by broadcaster',
      })
    );
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException') {
      logger.info('User already left chat, continuing with BOUNCE record', { sessionId, targetUserId });
    } else {
      throw error;
    }
  }

  // 7. Write BOUNCE moderation record to DynamoDB
  const now = new Date().toISOString();
  await getDocumentClient().send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: `MOD#${now}#${uuidv4()}`,
        entityType: 'MODERATION',
        actionType: 'BOUNCE',
        userId: targetUserId,
        actorId,
        sessionId,
        createdAt: now,
      },
    })
  );

  // 8. Return success
  return resp(200, { message: 'User bounced' });
};
