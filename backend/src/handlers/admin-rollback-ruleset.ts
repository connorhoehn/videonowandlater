/**
 * POST /admin/rulesets/{name}/rollback
 * Flips CURRENT pointer back to a prior version.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { setCurrentVersion, getRuleset } from '../repositories/ruleset-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-rollback-ruleset' } });

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

  const name = event.pathParameters?.name;
  if (!name) return resp(400, { error: 'name is required' });

  let toVersion: number | undefined;
  try {
    const body = JSON.parse(event.body ?? '{}');
    toVersion = typeof body.toVersion === 'number' ? body.toVersion : undefined;
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  if (toVersion === undefined || toVersion < 1) {
    return resp(400, { error: 'toVersion (positive integer) is required' });
  }

  try {
    await setCurrentVersion(tableName, name, toVersion);
    const current = await getRuleset(tableName, name, toVersion);
    logger.info('Rolled back ruleset', { name, toVersion, adminUserId });
    return resp(200, { current });
  } catch (err: any) {
    logger.error('Error rolling back ruleset', { name, toVersion, error: err instanceof Error ? err.message : String(err) });
    return resp(400, { error: err.message });
  }
}
