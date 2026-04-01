/**
 * GET /recordings handler - list recently recorded sessions
 * Supports cursor-based pagination via ?cursor= query parameter
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getRecentRecordings } from '../repositories/session-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'list-recordings' } });

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

    const cursor = event.queryStringParameters?.cursor;
    const result = await getRecentRecordings(tableName, 20, cursor);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      },
      body: JSON.stringify({
        recordings: result.items,
        ...(result.nextCursor && { nextCursor: result.nextCursor }),
      }),
    };
  } catch (error: any) {
    logger.error('Error listing recordings', { errorMessage: error.message });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      },
      body: JSON.stringify({ error: 'Failed to list recordings' }),
    };
  }
};
