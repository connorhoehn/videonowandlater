/**
 * POST   /users/{userId}/follow   — follow
 * DELETE /users/{userId}/follow   — unfollow
 *
 * Both are idempotent — second call is a no-op returning 200.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { follow, unfollow } from '../repositories/follow-repository';

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

  const follower = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!follower) return resp(401, { error: 'Unauthorized' });

  const followee = event.pathParameters?.userId;
  if (!followee) return resp(400, { error: 'userId is required' });
  if (follower === followee) return resp(400, { error: 'Cannot follow yourself' });

  const method = event.httpMethod?.toUpperCase();
  try {
    if (method === 'DELETE') {
      const removed = await unfollow(tableName, follower, followee);
      return resp(200, { following: false, changed: removed });
    }
    const created = await follow(tableName, follower, followee);
    return resp(200, { following: true, changed: created });
  } catch (err: any) {
    return resp(500, { error: err instanceof Error ? err.message : 'Internal error' });
  }
}
