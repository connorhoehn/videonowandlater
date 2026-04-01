/**
 * GET /sessions/{sessionId}/reactions handler - retrieve reactions for time range
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getReactionsInTimeRange } from '../repositories/reaction-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-reactions' } });

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

  // Extract query parameters with defaults
  const queryParams = event.queryStringParameters || {};
  const startTime = queryParams.startTime ? parseInt(queryParams.startTime, 10) : 0;
  const endTime = queryParams.endTime ? parseInt(queryParams.endTime, 10) : Date.now();
  const limit = queryParams.limit ? parseInt(queryParams.limit, 10) : 100;

  // Validate limit
  if (limit > 100) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'limit must not exceed 100' }),
    };
  }

  try {
    const reactions = await getReactionsInTimeRange(
      tableName,
      sessionId,
      startTime,
      endTime,
      limit
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ reactions }),
    };
  } catch (error: any) {
    logger.error('Error getting reactions', { sessionId, error: error instanceof Error ? error.message : String(error) });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to get reactions' }),
    };
  }
};
