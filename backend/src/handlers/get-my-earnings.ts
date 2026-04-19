/**
 * GET /me/earnings?from=<ISO>&to=<ISO>
 * Passthrough to vnl-ads `GET /v1/creators/{userId}/payouts`.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getPayouts } from '../lib/ad-service-client';
import { resp, getUserId } from '../lib/http';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = getUserId(event);
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const result = await getPayouts(userId, {
    from: event.queryStringParameters?.from ?? undefined,
    to: event.queryStringParameters?.to ?? undefined,
  });
  return resp(200, result);
};
