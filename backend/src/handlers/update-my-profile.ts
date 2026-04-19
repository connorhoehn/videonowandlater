/**
 * PATCH /me/profile — update the caller's profile.
 * Body accepts any subset of { displayName, handle, bio, avatarUrl }.
 * Handle claim is atomic; 409 if taken.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { upsertProfile, HandleTakenError } from '../repositories/profile-repository';

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

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  const patch: { displayName?: string; handle?: string; bio?: string; avatarUrl?: string } = {};
  if (typeof body.displayName === 'string') patch.displayName = body.displayName.trim().slice(0, 80);
  if (typeof body.handle === 'string') patch.handle = body.handle;
  if (typeof body.bio === 'string') patch.bio = body.bio.trim().slice(0, 500);
  if (typeof body.avatarUrl === 'string') patch.avatarUrl = body.avatarUrl.trim().slice(0, 500);

  if (Object.keys(patch).length === 0) {
    return resp(400, { error: 'No profile fields provided' });
  }

  try {
    const profile = await upsertProfile(tableName, userId, patch);
    return resp(200, { profile });
  } catch (err: any) {
    if (err instanceof HandleTakenError) {
      return resp(409, { error: 'handle_taken', handle: err.handle });
    }
    if (err?.message?.startsWith?.('Invalid handle')) {
      return resp(400, { error: err.message });
    }
    return resp(500, { error: err instanceof Error ? err.message : 'Internal error' });
  }
}
