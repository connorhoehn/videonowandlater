/**
 * GET /me/impression-series?from=<ISO>&to=<ISO>&granularity=day
 * Passthrough to vnl-ads `GET /v1/creators/{userId}/impressions`.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getCreatorImpressionSeries } from '../lib/ad-service-client';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const q = event.queryStringParameters ?? {};
  const granularity = q.granularity === 'hour' ? 'hour' : 'day';
  const to = q.to ?? new Date().toISOString();
  const from = q.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const result = await getCreatorImpressionSeries(userId, { from, to, granularity });
  return resp(200, result);
};
