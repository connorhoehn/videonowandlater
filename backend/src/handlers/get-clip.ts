/**
 * GET /clips/{clipId}
 * Publicly accessible when the clip's session is public (not isPrivate).
 * Private-session clips require the caller to be the session owner or admin.
 *
 * Returns clip metadata plus a short-lived signed URL pointing at the
 * MP4 in the recordings bucket (15-minute TTL).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getClipById } from '../repositories/clip-repository';
import { getSessionById } from '../repositories/session-repository';
import { isAdmin } from '../lib/admin-auth';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-clip' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const SIGNED_URL_TTL_SEC = 15 * 60;

// Module-scope S3 client reused across warm invocations
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  const recordingsBucket = process.env.RECORDINGS_BUCKET;

  if (!tableName || !recordingsBucket) {
    logger.error('Missing required environment variables');
    return resp(500, { error: 'Server misconfigured' });
  }

  const clipId = event.pathParameters?.clipId;
  if (!clipId) return resp(400, { error: 'clipId is required' });

  try {
    const clip = await getClipById(tableName, clipId);
    if (!clip || clip.status === 'deleted') {
      return resp(404, { error: 'Clip not found' });
    }

    const session = await getSessionById(tableName, clip.sessionId);
    if (!session) return resp(404, { error: 'Clip session not found' });

    const isPublic = !session.isPrivate;
    const callerId = event.requestContext?.authorizer?.claims?.['cognito:username'];
    const admin = isAdmin(event);

    if (!isPublic) {
      // Private session — require auth
      if (!callerId) return resp(401, { error: 'Unauthorized' });
      const isOwner = session.userId === callerId;
      const isAuthor = clip.authorId === callerId;
      if (!isOwner && !admin && !isAuthor) {
        return resp(403, { error: 'Forbidden' });
      }
    }

    let signedUrl: string | undefined;
    if (clip.status === 'ready' && clip.s3Key) {
      try {
        const command = new GetObjectCommand({
          Bucket: recordingsBucket,
          Key: clip.s3Key,
        });
        signedUrl = await getSignedUrl(s3Client, command, { expiresIn: SIGNED_URL_TTL_SEC });
      } catch (err: any) {
        logger.warn('Failed to sign URL (non-fatal)', { error: err?.message, clipId });
      }
    }

    return resp(200, {
      clipId: clip.clipId,
      sessionId: clip.sessionId,
      authorId: clip.authorId,
      title: clip.title,
      startSec: clip.startSec,
      endSec: clip.endSec,
      durationSec: clip.durationSec,
      createdAt: clip.createdAt,
      status: clip.status,
      signedUrl,
      signedUrlExpiresIn: signedUrl ? SIGNED_URL_TTL_SEC : undefined,
      sessionTitle: undefined,
      sessionUserId: session.userId,
    });
  } catch (err: any) {
    logger.error('get-clip error', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal server error' });
  }
}
