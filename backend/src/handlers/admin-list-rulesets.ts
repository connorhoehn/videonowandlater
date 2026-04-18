/**
 * GET /admin/rulesets
 * Admin-only. Seeds default rulesets on first call, then returns the full list.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { listRulesets, seedDefaultRulesets } from '../repositories/ruleset-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-list-rulesets' } });

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
    await seedDefaultRulesets(tableName);
    const rulesets = await listRulesets(tableName);
    logger.info('Listed rulesets', { count: rulesets.length });
    return resp(200, { rulesets });
  } catch (err: any) {
    logger.error('Error listing rulesets', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
