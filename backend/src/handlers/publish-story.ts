/**
 * POST /stories/{sessionId}/publish handler - publish a story (set to LIVE)
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { SessionType, SessionStatus } from '../domain/session';
import { getSessionById } from '../repositories/session-repository';
import { publishStory, updateStorySegmentsWithUrls } from '../repositories/story-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'publish-story' } });

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN;
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

  try {
    // Fetch session and validate
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

    const segments = session.storySegments || [];
    if (segments.length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Story must have at least 1 segment' }),
      };
    }

    // Generate CloudFront URLs for all segments (immutable — no domain object mutation)
    const updatedSegments = segments.map(s => ({
      ...s,
      url: s.url || (cloudFrontDomain ? `https://${cloudFrontDomain}/${s.s3Key}` : undefined),
    }));

    // Persist updated segments with URLs
    await updateStorySegmentsWithUrls(tableName, sessionId, updatedSegments);

    // Publish story (sets status to LIVE)
    await publishStory(tableName, sessionId);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        status: 'published',
        segments: updatedSegments,
      }),
    };
  } catch (error) {
    logger.error('Error publishing story', { sessionId, error: error instanceof Error ? error.message : String(error) });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to publish story' }),
    };
  }
};
