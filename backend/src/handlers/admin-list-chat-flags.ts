/**
 * GET /admin/chat-flags?status=pending&limit=50
 *
 * Admin-only endpoint that returns the cross-session chat moderation queue.
 * For MVP we only support `status=pending` — any other value is ignored and
 * returns 400 so the FE doesn't accidentally reach for a filter we haven't
 * implemented yet.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { isAdmin } from '../lib/admin-auth';
import { listPendingFlags } from '../repositories/chat-moderation-repository';

const logger = new Logger({
  serviceName: 'vnl-admin',
  persistentKeys: { handler: 'admin-list-chat-flags' },
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

  const status = event.queryStringParameters?.status ?? 'pending';
  if (status !== 'pending') {
    return resp(400, { error: `Unsupported status filter: ${status}` });
  }

  const rawLimit = event.queryStringParameters?.limit;
  let limit = 50;
  if (rawLimit !== undefined) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 200) {
      return resp(400, { error: 'limit must be between 1 and 200' });
    }
    limit = parsed;
  }

  try {
    const flags = await listPendingFlags(tableName, { limit });
    logger.info('Listed pending chat flags', { count: flags.length });
    return resp(200, { flags });
  } catch (err: any) {
    logger.error('Error listing chat flags', {
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err.message });
  }
}
