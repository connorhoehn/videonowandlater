/**
 * GET /me/earnings?from=<ISO>&to=<ISO>
 *
 * Passthrough to vnl-ads `GET /v1/creators/{userId}/payouts`. Returns the
 * payout list + aggregate unchanged from vnl-ads.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getPayouts } from '../lib/ad-service-client';

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

  const from = event.queryStringParameters?.from;
  const to = event.queryStringParameters?.to;

  const result = await getPayouts(userId, {
    from: from ?? undefined,
    to: to ?? undefined,
  });
  return resp(200, result);
};
