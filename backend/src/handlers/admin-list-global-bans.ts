/**
 * GET /admin/bans
 * Admin-only endpoint to list all active global chat bans.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { isAdmin } from '../lib/admin-auth';
import { listGlobalBans } from '../repositories/ban-repository';

const logger = new Logger({
  serviceName: 'vnl-admin',
  persistentKeys: { handler: 'admin-list-global-bans' },
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

  try {
    const bans = await listGlobalBans(tableName);
    logger.info('Listed global bans', { count: bans.length });
    return resp(200, { bans });
  } catch (err: any) {
    logger.error('Error listing global bans', {
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err.message });
  }
}
