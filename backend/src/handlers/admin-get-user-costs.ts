/**
 * GET /admin/costs/user/{userId}
 * Admin-only endpoint to return all cost line items for a specific user.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { queryCostsByUser } from '../repositories/cost-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-get-user-costs' } });

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

  const userId = event.pathParameters?.userId;
  if (!userId) return resp(400, { error: 'userId is required' });

  try {
    const costs = await queryCostsByUser(tableName, userId);

    // Sum total cost
    const totalCostUsd = Math.round(
      costs.reduce((sum, item) => sum + item.costUsd, 0) * 1_000_000
    ) / 1_000_000;

    logger.info('User costs retrieved', { userId, itemCount: costs.length, totalCostUsd });

    return resp(200, { costs, totalCostUsd });
  } catch (err: any) {
    logger.error('Error retrieving user costs', { userId, error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
