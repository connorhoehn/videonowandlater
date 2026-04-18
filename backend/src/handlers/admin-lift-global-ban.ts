/**
 * DELETE /admin/bans/{userId}
 * Admin-only endpoint to lift a user's global chat ban.
 * Idempotent — deleting a non-existent ban returns 200.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { liftGlobalBan } from '../repositories/ban-repository';

const logger = new Logger({
  serviceName: 'vnl-admin',
  persistentKeys: { handler: 'admin-lift-global-ban' },
});

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

  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });
  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  const userId = event.pathParameters?.userId;
  if (!userId) return resp(400, { error: 'userId path parameter required' });

  try {
    await liftGlobalBan(tableName, userId);
    logger.info('Lifted global ban', { userId, adminUserId });
    return resp(200, { message: 'Global ban lifted', userId });
  } catch (err: any) {
    logger.error('Error lifting global ban', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err.message });
  }
}
