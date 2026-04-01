/**
 * POST /sessions/:id/start handler
 * Returns ingest configuration for broadcaster to start streaming
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { SessionStatus } from '../domain/session';
import { updateSessionStatus } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'start-broadcast' } });

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  const sessionId = event.pathParameters?.sessionId;
  const body = event.body ? JSON.parse(event.body) : {};
  const goLive = body.goLive === true;

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

  // Check status — allow CREATING or LIVE (re-fetching credentials is safe)
  if (session.status !== SessionStatus.CREATING && session.status !== SessionStatus.LIVE) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Session already ended' }),
    };
  }

  // If broadcaster is explicitly going live and session is still CREATING, transition now
  if (goLive && session.status === SessionStatus.CREATING) {
    try {
      await updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt');
    } catch (err: any) {
      logger.warn('Could not transition session to LIVE (may already be LIVE)', { error: err.message });
    }
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
