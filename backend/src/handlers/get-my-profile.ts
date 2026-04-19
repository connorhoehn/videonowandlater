/**
 * GET /me/profile — returns the caller's profile + stats. Creates a skeleton
 * profile row on first call so the client doesn't have to.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getProfile, getStats, upsertProfile } from '../repositories/profile-repository';
import { resp, getUserId } from '../lib/http';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const userId = getUserId(event);
  if (!userId) return resp(401, { error: 'Unauthorized' });

  let profile = await getProfile(tableName, userId);
  if (!profile) {
    profile = await upsertProfile(tableName, userId, { displayName: userId });
  }
  const stats = await getStats(tableName, userId);
  return resp(200, { profile, stats });
}
