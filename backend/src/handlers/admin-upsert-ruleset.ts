/**
 * POST /admin/rulesets/{name}
 * Creates a new immutable version of the ruleset and flips CURRENT to it.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { createRulesetVersion } from '../repositories/ruleset-repository';
import type { RulesetSeverity } from '../domain/ruleset';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-upsert-ruleset' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const VALID_SEVERITY: RulesetSeverity[] = ['low', 'med', 'high'];

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });
  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  const name = event.pathParameters?.name;
  if (!name) return resp(400, { error: 'name is required' });

  let body: {
    description?: string;
    disallowedItems?: unknown;
    severity?: RulesetSeverity;
  };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  const description = (body.description ?? '').toString();
  const severity = body.severity;
  const disallowedItems = body.disallowedItems;

  if (!description.trim()) return resp(400, { error: 'description is required' });
  if (!severity || !VALID_SEVERITY.includes(severity)) {
    return resp(400, { error: `severity must be one of ${VALID_SEVERITY.join(', ')}` });
  }
  if (!Array.isArray(disallowedItems) || disallowedItems.some((i) => typeof i !== 'string') || disallowedItems.length === 0) {
    return resp(400, { error: 'disallowedItems must be a non-empty array of strings' });
  }

  try {
    const row = await createRulesetVersion(tableName, {
      name,
      description,
      disallowedItems: disallowedItems as string[],
      severity,
      createdBy: adminUserId,
    });
    logger.info('Created new ruleset version', { name, version: row.version, adminUserId });
    return resp(201, { ruleset: row });
  } catch (err: any) {
    logger.error('Error creating ruleset version', { name, error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
