/**
 * POST /sessions/{sessionId}/moderation-upload
 * Participant in a moderation-enabled session requests a one-shot presigned S3
 * PUT URL for a captured video frame. The S3 ObjectCreated event fans out to
 * moderate-frame for Nova Lite classification.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSessionById, getHangoutParticipants } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'request-moderation-upload' } });

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (!s3Client) s3Client = new S3Client({});
  return s3Client;
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const EXPIRES_IN_SECONDS = 60;

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  const bucket = process.env.MODERATION_BUCKET;
  if (!tableName || !bucket) return resp(500, { error: 'server not configured' });

  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    // Only sessions that enabled moderation may request upload URLs
    if (!(session as any).moderationEnabled) {
      return resp(403, { error: 'Moderation not enabled for this session' });
    }

    // Authz: caller must be the session owner or a hangout participant
    let allowed = session.userId === userId;
    if (!allowed) {
      const participants = await getHangoutParticipants(tableName, sessionId);
      allowed = participants.some((p) => p.userId === userId);
    }
    if (!allowed) return resp(403, { error: 'Not a participant' });

    const timestamp = Date.now();
    const key = `moderation-frames/session-${sessionId}/participant-${userId}/${timestamp}.jpg`;

    const uploadUrl = await getSignedUrl(
      getS3(),
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: 'image/jpeg',
      }),
      { expiresIn: EXPIRES_IN_SECONDS },
    );

    logger.info('Issued moderation upload URL', { sessionId, userId, key });
    return resp(200, { uploadUrl, key, expiresIn: EXPIRES_IN_SECONDS });
  } catch (err: any) {
    logger.error('Error issuing moderation upload URL', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err.message });
  }
}
