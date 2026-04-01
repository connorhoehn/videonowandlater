/**
 * GET /activity handler - list recent activity (broadcasts and hangouts)
 *
 * Filters private sessions by owner (userId must match session owner)
 * Public sessions (isPrivate=false or undefined) visible to all users
 * Supports cursor-based pagination via ?cursor= query parameter
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getRecentActivity } from '../repositories/session-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'list-activity' } });

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.TABLE_NAME;

    if (!tableName) {
      logger.error('TABLE_NAME environment variable not set');
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        },
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }

    // Extract userId from Cognito token
    const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
    const cursor = event.queryStringParameters?.cursor;

    const result = await getRecentActivity(tableName, 20, cursor);

    // Filter private sessions: only show to owner
    const sessions = result.items.filter((session: any) => {
      if (!session.isPrivate) return true;
      return session.userId === userId;
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      },
      body: JSON.stringify({
        sessions,
        ...(result.nextCursor && { nextCursor: result.nextCursor }),
      }),
    };
  } catch (error: any) {
    logger.error('Error listing activity', { errorMessage: error.message });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      },
      body: JSON.stringify({ error: 'Failed to list activity' }),
    };
  }
};
