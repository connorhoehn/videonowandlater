/**
 * GET /sessions/{sessionId}/recording/download
 *
 * Returns a short-lived (15 min) presigned S3 URL for downloading the
 * session's MediaConvert-produced MP4 file.
 *
 * Authz:
 *   - Session owner: always allowed
 *   - Admin (cognito:groups contains 'admin'): always allowed
 *   - Anyone else: allowed only if session is public (isPrivate !== true)
 *
 * Response: { url: string, expiresAt: string }
 * 404: session not found OR recording not yet available (convertStatus !== 'available')
 * 403: caller lacks permission (private + non-owner + non-admin)
 *
 * The MP4 key convention comes from start-transcribe.ts / MediaConvert output:
 *   s3://<transcriptionBucket>/<sessionId>/masterrecording.mp4   (broadcasts)
 *
 * We use @aws-sdk/s3-request-presigner (already a project dependency) rather
 * than @aws-sdk/cloudfront-signer so we don't need a CloudFront key-pair /
 * trusted-signer setup just for download.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSessionById } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'get-recording-download-url' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

const EXPIRES_IN_SECONDS = 15 * 60; // 15 minutes

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function extractUserId(event: APIGatewayProxyEvent): string | undefined {
  const claims = event.requestContext?.authorizer?.claims;
  if (!claims) return undefined;
  return (
    (claims['cognito:username'] as string | undefined) ||
    (claims['username'] as string | undefined) ||
    (claims['sub'] as string | undefined)
  );
}

function callerIsAdmin(event: APIGatewayProxyEvent): boolean {
  const claims = event.requestContext?.authorizer?.claims;
  if (!claims) return false;
  const groupsRaw = (claims['cognito:groups'] as string | string[] | undefined) ?? '';
  const groups = Array.isArray(groupsRaw)
    ? groupsRaw
    : String(groupsRaw).split(/[,\s]+/).filter(Boolean);
  if (groups.some((g) => g.toLowerCase() === 'admin')) return true;
  const explicitRole = (claims['custom:role'] as string | undefined) ?? '';
  return explicitRole === 'admin';
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });
  if (!transcriptionBucket) return resp(500, { error: 'TRANSCRIPTION_BUCKET not set' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    // Recording must be available. We trust convertStatus / recordingStatus to
    // signal MediaConvert has produced the MP4.
    const recordingReady =
      session.recordingStatus === 'available' &&
      (session.convertStatus === undefined || session.convertStatus === 'available');
    if (!recordingReady) {
      return resp(404, { error: 'Recording not available for download' });
    }

    // Authz
    const userId = extractUserId(event);
    const isOwner = !!userId && session.userId === userId;
    const isAdmin = callerIsAdmin(event);
    const isPublic = session.isPrivate !== true;

    if (!isOwner && !isAdmin && !isPublic) {
      return resp(403, { error: 'Forbidden: not authorized to download this recording' });
    }

    // Build MP4 key (broadcast convention — matches start-transcribe.ts)
    const mp4Key = `${sessionId}/masterrecording.mp4`;

    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const command = new GetObjectCommand({
      Bucket: transcriptionBucket,
      Key: mp4Key,
      // Hint browsers to save rather than stream in-place.
      ResponseContentDisposition: `attachment; filename="${sessionId}.mp4"`,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN_SECONDS });
    const expiresAt = new Date(Date.now() + EXPIRES_IN_SECONDS * 1000).toISOString();

    logger.info('Download URL issued', { sessionId, isOwner, isAdmin, isPublic });

    return resp(200, { url, expiresAt });
  } catch (err: any) {
    logger.error('get-recording-download-url error', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: 'Internal server error' });
  }
}
