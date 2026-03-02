/**
 * GET /sessions/{sessionId}/chat/messages handler - retrieve chat history
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getMessageHistory } from '../repositories/chat-repository';

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

  // Parse limit parameter
  const limitParam = event.queryStringParameters?.limit;
  let limit = 50; // Default

  if (limitParam) {
    const parsedLimit = parseInt(limitParam, 10);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'limit must be between 1 and 100' }),
      };
    }
    limit = parsedLimit;
  }

  try {
    const messages = await getMessageHistory(tableName, sessionId, limit);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ messages }),
    };
  } catch (error: any) {
    console.error('Error retrieving chat history:', { sessionId, error });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to retrieve chat history' }),
    };
  }
};
