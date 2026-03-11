/**
 * POST /sessions/{sessionId}/comments handler
 * Creates a timestamped comment for a video session
 *
 * Body: { text: string, videoPositionMs: number }
 * Response 201: { commentId, videoPositionMs, createdAt }
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

interface CreateCommentRequest {
  text: string;
  videoPositionMs: number;
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

  // Parse request body
  let body: CreateCommentRequest;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  // Validate text
  if (!body.text || typeof body.text !== 'string' || body.text.trim() === '') {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'text is required and must be a non-empty string' }),
    };
  }

  // Validate videoPositionMs
  if (body.videoPositionMs === undefined || body.videoPositionMs === null) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'videoPositionMs is required' }),
    };
  }

  if (typeof body.videoPositionMs !== 'number' || body.videoPositionMs < 0) {
    return {
      statusCode: 400,
      headers: HEADERS,
      body: JSON.stringify({ error: 'videoPositionMs must be a non-negative number' }),
    };
  }

  const commentId = uuid();
  const createdAt = new Date().toISOString();
  const { text, videoPositionMs } = body;

  // Build SK: COMMENT#{15-digit zero-padded ms}#{uuid}
  const paddedMs = videoPositionMs.toString().padStart(15, '0');
  const sk = `COMMENT#${paddedMs}#${commentId}`;

  // Persist comment to DynamoDB
  const client = getDocumentClient();
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: sk,
        entityType: 'COMMENT',
        commentId,
        sessionId,
        userId,
        text,
        videoPositionMs,
        createdAt,
      },
    })
  );

  return {
    statusCode: 201,
    headers: HEADERS,
    body: JSON.stringify({ commentId, videoPositionMs, createdAt }),
  };
};
