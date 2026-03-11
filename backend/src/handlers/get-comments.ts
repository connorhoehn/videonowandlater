/**
 * GET /sessions/{sessionId}/comments handler
 * Returns all comments for a session in ascending videoPositionMs order
 *
 * Response 200: { comments: Comment[] }
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

interface Comment {
  commentId: string;
  sessionId: string;
  userId: string;
  text: string;
  videoPositionMs: number;
  createdAt: string;
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  // Validate sessionId
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'sessionId required' }),
    };
  }

  // Validate userId from Cognito authorizer
  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) {
    return {
      statusCode: 401,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // Query DynamoDB for all comments for this session
  // SK prefix COMMENT# + natural sort = ascending videoPositionMs order
  const client = getDocumentClient();
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':prefix': 'COMMENT#',
      },
      Limit: 500,
    })
  );

  const items = result.Items ?? [];

  const comments: Comment[] = items.map((item) => ({
    commentId: item.commentId as string,
    sessionId: item.sessionId as string,
    userId: item.userId as string,
    text: item.text as string,
    videoPositionMs: item.videoPositionMs as number,
    createdAt: item.createdAt as string,
  }));

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ comments }),
  };
};
