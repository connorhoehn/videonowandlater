/**
 * GET /activity handler - list recent activity (broadcasts and hangouts)
 *
 * Filters private sessions by owner (userId must match session owner)
 * Public sessions (isPrivate=false or undefined) visible to all users
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRecentActivity } from '../repositories/session-repository';

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.TABLE_NAME;

    if (!tableName) {
      console.error('TABLE_NAME environment variable not set');
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

    let sessions = await getRecentActivity(tableName, 20);

    // Filter private sessions: only show to owner
    // Public sessions (isPrivate is false or undefined) are visible to everyone
    sessions = sessions.filter((session: any) => {
      // Public sessions are visible to everyone
      if (!session.isPrivate) {
        return true;
      }
      // Private sessions are only visible to the owner
      return session.userId === userId;
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      },
      body: JSON.stringify({ sessions }),
    };
  } catch (error) {
    console.error('Error listing activity:', error);
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
