/**
 * POST /stories/{sessionId}/segments handler - upload a segment to a story
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@aws-lambda-powertools/logger';
import { SessionType, SessionStatus } from '../domain/session';
import { getSessionById } from '../repositories/session-repository';
import { addStorySegment } from '../repositories/story-repository';
import type { StorySegment } from '../domain/story';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'add-story-segment' } });

const s3Client = new S3Client({ region: process.env.AWS_REGION });

const VALID_TYPES = ['image', 'video'] as const;
const VALID_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'];
const MAX_SEGMENTS = 10;

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

interface AddSegmentRequest {
  type: 'image' | 'video';
  // For file upload (existing flow):
  filename?: string;
  contentType?: string;
  duration?: number;
  // For platform content (new flow):
  sourceSessionId?: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const bucketName = process.env.STORY_BUCKET!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];

  if (!userId) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'sessionId required' }),
    };
  }

  // Parse request body
  let body: AddSegmentRequest;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  // Validate type
  if (!body.type || !VALID_TYPES.includes(body.type)) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'type must be "image" or "video"' }),
    };
  }

  const isSourceSession = !!body.sourceSessionId;

  // Validate file-upload fields only when NOT using sourceSessionId
  if (!isSourceSession) {
    if (!body.contentType || !VALID_CONTENT_TYPES.includes(body.contentType)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` }),
      };
    }

    // Validate duration for video segments
    if (body.type === 'video' && (!body.duration || body.duration <= 0)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Duration required for video segments (positive number in ms)' }),
      };
    }

    if (body.duration && (body.duration < 1000 || body.duration > 60000)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Duration must be between 1 and 60 seconds' }),
      };
    }

    if (!body.filename) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'filename required' }),
      };
    }
  }

  try {
    // Fetch story session and validate ownership
    const session = await getSessionById(tableName, sessionId);
    if (!session) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session not found' }),
      };
    }

    if (session.sessionType !== SessionType.STORY) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session is not a STORY' }),
      };
    }

    if (session.userId !== userId) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Forbidden' }),
      };
    }

    if (session.status !== SessionStatus.CREATING) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Story is not in CREATING status' }),
      };
    }

    // Check segment limit
    const currentSegments = session.storySegments || [];
    if (currentSegments.length >= MAX_SEGMENTS) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: `Maximum ${MAX_SEGMENTS} segments allowed` }),
      };
    }

    const segmentId = uuid();

    // --- Source session flow: reference an existing platform recording ---
    if (isSourceSession) {
      const sourceSession = await getSessionById(tableName, body.sourceSessionId!);
      if (!sourceSession) {
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'Source session not found' }),
        };
      }

      // Determine segment URL based on type
      let segmentUrl: string | undefined;
      if (body.type === 'video') {
        segmentUrl = sourceSession.recordingHlsUrl || sourceSession.posterFrameUrl;
      } else {
        segmentUrl = sourceSession.posterFrameUrl || sourceSession.thumbnailUrl;
      }

      if (!segmentUrl) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'Source session has no available recording content' }),
        };
      }

      // For video, derive duration from source (cap at 60s)
      const duration = body.type === 'video'
        ? Math.min(sourceSession.recordingDuration || 15000, 60000)
        : body.duration;

      const segment: StorySegment = {
        segmentId,
        type: body.type,
        s3Key: `ref:sessions/${body.sourceSessionId}`,
        url: segmentUrl,
        duration,
        order: currentSegments.length,
        createdAt: new Date().toISOString(),
      };

      await addStorySegment(tableName, sessionId, segment);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          segmentId,
          sourceSessionId: body.sourceSessionId,
        }),
      };
    }

    // --- File upload flow (existing behavior) ---
    const ext = CONTENT_TYPE_TO_EXT[body.contentType!];
    const s3Key = `stories/${sessionId}/${segmentId}.${ext}`;

    // Create presigned URL
    const presignedUrl = await getSignedUrl(s3Client, new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      ContentType: body.contentType,
    }), { expiresIn: 900 });

    // Build segment object
    const segment: StorySegment = {
      segmentId,
      type: body.type,
      s3Key,
      duration: body.duration,
      order: currentSegments.length,
      createdAt: new Date().toISOString(),
    };

    // Persist segment
    await addStorySegment(tableName, sessionId, segment);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        segmentId,
        uploadUrl: presignedUrl,
        s3Key,
      }),
    };
  } catch (error) {
    logger.error('Error adding story segment', { sessionId, error: error instanceof Error ? error.message : String(error) });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to add story segment' }),
    };
  }
};
