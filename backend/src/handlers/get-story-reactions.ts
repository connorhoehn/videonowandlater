/**
 * GET /stories/{sessionId}/reactions handler - retrieve reactions for a story (owner only)
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { getStoryReactions } from '../repositories/story-repository';
import { SessionType } from '../domain/session';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-story-reactions' } });

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

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

    // Only the story owner can view the reaction list
    if (session.userId !== userId) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Only the story owner can view reactions' }),
      };
    }

    const reactions = await getStoryReactions(tableName, sessionId);

    // Build summary: group by emoji and count
    const summary: Record<string, number> = {};
    for (const reaction of reactions) {
      summary[reaction.emoji] = (summary[reaction.emoji] || 0) + 1;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ reactions, summary }),
    };
  } catch (error: any) {
    logger.error('Error getting story reactions', { sessionId, error: error instanceof Error ? error.message : String(error) });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to get story reactions' }),
    };
  }
};
