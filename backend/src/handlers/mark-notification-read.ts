/**
 * POST /me/notifications/{notificationId}/read
 * Body: { createdAt: ISO }  — required to reconstruct the SK (NOTIF#<createdAt>#<id>).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { markRead } from '../repositories/notification-repository';

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

  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const notificationId = event.pathParameters?.notificationId;
  if (!notificationId) return resp(400, { error: 'notificationId required' });

  let body: { createdAt?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON' });
  }
  if (!body.createdAt) return resp(400, { error: 'createdAt required in body' });

  await markRead(tableName, userId, notificationId, body.createdAt);
  return resp(200, { ok: true });
}
