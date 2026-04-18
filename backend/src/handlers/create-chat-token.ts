/**
 * POST /sessions/{sessionId}/chat/token handler - generate chat token
 * Includes a blocklist check: banned users (global or per-session) cannot obtain a token.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { generateChatToken } from '../services/chat-service';
import { isUserBanned } from '../repositories/ban-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'create-chat-token' } });

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
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

  // Blocklist check: deny token if user is banned (globally or from this session)
  if (await isUserBanned(tableName, userId, sessionId)) {
    return {
      statusCode: 403,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'You have been removed from this chat' }),
    };
  }

  try {
    const result = await generateChatToken(tableName, {
      sessionId,
      userId,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(result),
    };
  } catch (error: any) {
    logger.error('Error generating chat token', { sessionId, userId, error: error instanceof Error ? error.message : String(error) });

    // Session not found
    if (error.message?.includes('not found')) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session not found' }),
      };
    }

    // Generic error
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to generate chat token' }),
    };
  }
};
