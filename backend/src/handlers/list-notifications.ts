/**
 * GET /me/notifications?unread=1&limit=50
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { listNotifications } from '../repositories/notification-repository';
import { getStats } from '../repositories/profile-repository';

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

  const onlyUnread = event.queryStringParameters?.unread === '1';
  const limitRaw = event.queryStringParameters?.limit;
  const limit = limitRaw ? Math.max(1, Math.min(100, parseInt(limitRaw, 10) || 50)) : 50;

  const items = await listNotifications(tableName, userId, { onlyUnread, limit });
  // Quick unread count in the same call so the bell badge doesn't need a second round-trip.
  const unreadItems = onlyUnread ? items : await listNotifications(tableName, userId, { onlyUnread: true, limit: 100 });
  return resp(200, {
    items,
    unreadCount: unreadItems.length,
  });
}
