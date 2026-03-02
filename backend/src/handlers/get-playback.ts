/**
 * GET /sessions/:id/playback handler
 * Returns playback URL for viewers to watch broadcasts
 * Public endpoint - no authentication required
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

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

  // Get session
  const sessionResult = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
  }));

  if (!sessionResult.Item) {
    return {
      statusCode: 404,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Session not found' }),
    };
  }

  const session = sessionResult.Item;

  // Extract resourceId from channel ARN
  const channelArn = session.claimedResources?.channel;
  if (!channelArn) {
    // HANGOUT sessions don't have channels, return empty playback
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        playbackUrl: null,
        status: session.status,
      }),
    };
  }

  const resourceId = channelArn.split('/').pop();

  // Get pool item for playback URL
  const poolResult = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: `POOL#CHANNEL#${resourceId}`,
      SK: 'METADATA',
    },
  }));

  if (!poolResult.Item) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Pool item not found' }),
    };
  }

  const poolItem = poolResult.Item;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      playbackUrl: poolItem.playbackUrl,
      status: session.status,
    }),
  };
};
