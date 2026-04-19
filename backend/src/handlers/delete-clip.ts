/**
 * DELETE /clips/{clipId}
 * Author or admin only. Soft-deletes the clip (status=deleted) so the
 * listing hides it; S3 lifecycle cleans up the MP4 asynchronously.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getClipById, softDeleteClip } from '../repositories/clip-repository';
import { isAdmin } from '../lib/admin-auth';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'delete-clip' } });

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
  if (!tableName) return resp(500, { error: 'Server misconfigured' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const clipId = event.pathParameters?.clipId;
  if (!clipId) return resp(400, { error: 'clipId is required' });

  try {
    const clip = await getClipById(tableName, clipId);
    if (!clip || clip.status === 'deleted') {
      return resp(404, { error: 'Clip not found' });
    }

    const admin = isAdmin(event);
    if (clip.authorId !== userId && !admin) {
      return resp(403, { error: 'Forbidden: only the clip author or an admin may delete' });
    }

    await softDeleteClip(tableName, clip.sessionId, clip.clipId);
    logger.info('Clip soft-deleted', { clipId, sessionId: clip.sessionId, deletedBy: userId });

    return resp(200, { clipId, status: 'deleted' });
  } catch (err: any) {
    logger.error('delete-clip error', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal server error' });
  }
}
