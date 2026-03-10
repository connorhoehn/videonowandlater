/**
 * POST /sessions/{sessionId}/report handler
 * Records a user-submitted message report in DynamoDB.
 * Any authenticated user can report a message — no ownership check.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getDocumentClient } from '../lib/dynamodb-client';

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

  // 1. Extract reporterId from Cognito claims
  const reporterId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!reporterId) {
    return resp(401, { error: 'Unauthorized' });
  }

  // 2. Extract sessionId from path parameters
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return resp(400, { error: 'sessionId required' });
  }

  // 3. Parse body for msgId and reportedUserId
  let msgId: string | undefined;
  let reportedUserId: string | undefined;
  try {
    const body = JSON.parse(event.body ?? '{}');
    msgId = body?.msgId;
    reportedUserId = body?.reportedUserId;
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }

  if (!msgId) {
    return resp(400, { error: 'msgId required in request body' });
  }
  if (!reportedUserId) {
    return resp(400, { error: 'reportedUserId required in request body' });
  }

  // 4. Write REPORT record to DynamoDB
  const now = new Date().toISOString();
  await getDocumentClient().send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: `MOD#${now}#${uuidv4()}`,
        entityType: 'MODERATION',
        actionType: 'REPORT',
        msgId,
        reporterId,
        reportedUserId,
        sessionId,
        createdAt: now,
      },
    })
  );

  // 5. Return success
  return resp(200, { message: 'Message reported' });
};
