/**
 * GET /admin/rulesets/{name}
 * Returns the active ruleset + full version history.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { getCurrentVersion, getRuleset, listRulesetVersions } from '../repositories/ruleset-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-get-ruleset' } });

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

  const name = event.pathParameters?.name;
  if (!name) return resp(400, { error: 'name is required' });

  try {
    const [activeVersion, versions] = await Promise.all([
      getCurrentVersion(tableName, name),
      listRulesetVersions(tableName, name),
    ]);

    if (activeVersion === null || versions.length === 0) {
      return resp(404, { error: 'Ruleset not found' });
    }

    const current = await getRuleset(tableName, name, activeVersion);
    return resp(200, { current, activeVersion, versions });
  } catch (err: any) {
    logger.error('Error getting ruleset', { name, error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
