/**
 * GET /sessions/:id/viewers handler
 * Returns current viewer count for a session
 * Public endpoint - no authentication required
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getViewerCount } from '../services/broadcast-service';

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const sessionId = event.pathParameters?.id;

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

  const docClient = getDocumentClient();

  // Get session to find channel ARN
  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
  }));

  if (!result.Item) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Session not found' }),
    };
  }

  const channelArn = result.Item.claimedResources?.channel;

  // If session has no channel (e.g., HANGOUT type), return 0 viewers
  if (!channelArn) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ viewerCount: 0 }),
    };
  }

  // Get viewer count from IVS API (cached)
  const viewerCount = await getViewerCount(channelArn);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ viewerCount }),
  };
};
