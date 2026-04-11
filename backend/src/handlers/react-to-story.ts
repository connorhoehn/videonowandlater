/**
 * POST /stories/{sessionId}/react handler - add emoji reaction to a story segment
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { reactToStory } from '../repositories/story-repository';
import { SessionType } from '../domain/session';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'react-to-story' } });

const VALID_EMOJIS = ['😂', '😮', '😍', '😢', '👏', '🔥'];

interface ReactToStoryRequest {
  segmentId: string;
  emoji: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  // Parse request body
  let body: ReactToStoryRequest;
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

  // Validate segmentId
  if (!body.segmentId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'segmentId required' }),
    };
  }

  // Validate emoji
  if (!body.emoji) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'emoji required' }),
    };
  }

  if (!VALID_EMOJIS.includes(body.emoji)) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: `Invalid emoji. Must be one of: ${VALID_EMOJIS.join(', ')}` }),
    };
  }

  // Extract userId from Cognito authorizer
  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
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

  try {
    // Validate session exists and is STORY type
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
        body: JSON.stringify({ error: 'Session is not a story' }),
      };
    }

    await reactToStory(tableName, sessionId, body.segmentId, userId, body.emoji);

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ ok: true }),
    };
  } catch (error: any) {
    logger.error('Error reacting to story', { sessionId, error: error instanceof Error ? error.message : String(error) });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to react to story' }),
    };
  }
};
