/**
 * GET /me/training-due?limit=1
 * Passthrough to vnl-ads `GET /v1/users/{userId}/training-due`.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getTrainingDue } from '../lib/ad-service-client';

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

  const limitRaw = event.queryStringParameters?.limit;
  const limit = limitRaw ? Math.max(1, Math.min(10, parseInt(limitRaw, 10) || 1)) : 1;

  const result = await getTrainingDue(userId, limit);
  return resp(200, result);
};
