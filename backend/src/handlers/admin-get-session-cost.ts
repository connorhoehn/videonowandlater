/**
 * GET /admin/costs/session/{sessionId}
 * Admin-only endpoint to return cost summary and line items for a specific session.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { getCostSummary, getCostLineItems } from '../repositories/cost-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-get-session-cost' } });

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

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  try {
    const [summary, lineItems] = await Promise.all([
      getCostSummary(tableName, sessionId),
      getCostLineItems(tableName, sessionId),
    ]);

    logger.info('Session cost retrieved', { sessionId, lineItemCount: lineItems.length });

    return resp(200, { summary, lineItems });
  } catch (err: any) {
    logger.error('Error retrieving session cost', { sessionId, error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
