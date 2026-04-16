/**
 * GET /sessions/{sessionId}/intent-flow
 * Get intent flow and results for a session.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getIntentFlow, getIntentResults } from '../repositories/intent-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-intent-flow' } });

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

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  try {
    const flowId = event.queryStringParameters?.flowId;
    const flow = await getIntentFlow(tableName, sessionId, flowId);
    const results = await getIntentResults(tableName, sessionId);

    return resp(200, { flow, results });
  } catch (err: any) {
    logger.error('Error getting intent flow', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
