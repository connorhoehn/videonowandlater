/**
 * GET /me/profile — returns the caller's profile + stats. Creates a skeleton
 * profile row on first call so the client doesn't have to.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getProfile, getStats, upsertProfile } from '../repositories/profile-repository';

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

  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  let profile = await getProfile(tableName, userId);
  if (!profile) {
    profile = await upsertProfile(tableName, userId, {
      displayName: userId,
    });
  }
  const stats = await getStats(tableName, userId);
  return resp(200, { profile, stats });
}
