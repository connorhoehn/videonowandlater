/**
 * POST /sessions/:id/start handler
 * Returns ingest configuration for broadcaster to start streaming
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { SessionStatus } from '../domain/session';

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  const sessionId = event.pathParameters?.id;

  // Auth check
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

  // Check ownership
  if (session.userId !== userId) {
    return {
      statusCode: 403,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  // Check status
  if (session.status !== SessionStatus.CREATING) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Session already started or ended' }),
    };
  }

  // Extract resourceId from channel ARN
  const channelArn = session.claimedResources?.channel;
  if (!channelArn) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Session has no channel resource' }),
    };
  }

  const resourceId = channelArn.split('/').pop();

  // Get pool item for ingest details
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
      ingestEndpoint: poolItem.ingestEndpoint,
      streamKey: poolItem.streamKey,
    }),
  };
};
