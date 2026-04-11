/**
 * POST /stories/{sessionId}/reply handler - send a reply to a story segment
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { getSessionById } from '../repositories/session-repository';
import { createStoryReply } from '../repositories/story-repository';
import { SessionType } from '../domain/session';
import type { StoryReply } from '../domain/story';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'reply-to-story' } });

const MAX_MESSAGE_LENGTH = 500;

interface ReplyToStoryRequest {
  segmentId: string;
  message: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  // Parse request body
  let body: ReplyToStoryRequest;
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

  // Validate message
  if (!body.message || body.message.trim().length === 0) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'message required and must be non-empty' }),
    };
  }

  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: `message must not exceed ${MAX_MESSAGE_LENGTH} characters` }),
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

    if (session.storyExpiresAt && new Date(session.storyExpiresAt) < new Date()) {
      return {
        statusCode: 410,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Story has expired' }),
      };
    }

    const replyId = uuid();
    const reply: StoryReply = {
      replyId,
      sessionId,
      segmentId: body.segmentId,
      senderId: userId,
      content: body.message.trim(),
      createdAt: new Date().toISOString(),
    };

    await createStoryReply(tableName, sessionId, reply);

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ replyId }),
    };
  } catch (error: any) {
    logger.error('Error replying to story', { sessionId, error: error instanceof Error ? error.message : String(error) });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to reply to story' }),
    };
  }
};
