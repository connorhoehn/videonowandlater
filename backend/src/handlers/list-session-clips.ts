/**
 * GET /sessions/{sessionId}/clips
 * Returns non-deleted clips for a session, newest first.
 * Public (no auth) when the session is not isPrivate; otherwise require
 * session owner / admin authentication.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getSessionById } from '../repositories/session-repository';
import { listClipsBySession } from '../repositories/clip-repository';
import { isAdmin } from '../lib/admin-auth';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'list-session-clips' } });

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

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    const isPublic = !session.isPrivate;
    const callerId = event.requestContext?.authorizer?.claims?.['cognito:username'];
    const admin = isAdmin(event);

    if (!isPublic) {
      if (!callerId) return resp(401, { error: 'Unauthorized' });
      const isOwner = session.userId === callerId;
      if (!isOwner && !admin) return resp(403, { error: 'Forbidden' });
    }

    const clips = await listClipsBySession(tableName, sessionId);

    // Return public-safe clip fields only (omit mediaConvertJobId, s3Key).
    const sanitized = clips.map((c) => ({
      clipId: c.clipId,
      sessionId: c.sessionId,
      authorId: c.authorId,
      title: c.title,
      startSec: c.startSec,
      endSec: c.endSec,
      durationSec: c.durationSec,
      createdAt: c.createdAt,
      status: c.status,
    }));

    return resp(200, { clips: sanitized });
  } catch (err: any) {
    logger.error('list-session-clips error', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal server error' });
  }
}
