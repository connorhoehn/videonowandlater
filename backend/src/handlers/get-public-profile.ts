/**
 * GET /creators/@{handle} — public creator profile.
 * No auth required. Returns profile + stats (session list is Phase 2).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getProfileByHandle, getStats } from '../repositories/profile-repository';

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

  const handle = event.pathParameters?.handle;
  if (!handle) return resp(400, { error: 'handle is required' });

  // Strip leading '@' if the URL encoded it in.
  const cleanHandle = handle.replace(/^@/, '');

  const profile = await getProfileByHandle(tableName, cleanHandle);
  if (!profile) return resp(404, { error: 'Creator not found' });

  const stats = await getStats(tableName, profile.userId);
  return resp(200, { profile, stats });
}
