/**
 * POST /sessions/{sessionId}/chat/messages handler - persist chat message
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SessionStatus } from '../domain/session';
import { calculateSessionRelativeTime } from '../domain/chat-message';
import type { ChatMessage } from '../domain/chat-message';
import { getSessionById } from '../repositories/session-repository';
import { persistMessage } from '../repositories/chat-repository';
import { getDocumentClient } from '../lib/dynamodb-client';

interface SendMessageRequest {
  messageId: string;
  content: string;
  senderId: string;
  senderAttributes: Record<string, string>;
  sentAt: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  // Parse request body
  let body: SendMessageRequest;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

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

  // Validate required fields
  if (!body.messageId || !body.content || !body.senderId || !body.sentAt) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Missing required fields: messageId, content, senderId, sentAt' }),
    };
  }

  try {
    // Fetch session to get startedAt timestamp
    const session = await getSessionById(tableName, sessionId);
    if (!session) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session not found' }),
      };
    }

    // Validate session is live
    if (session.status !== SessionStatus.LIVE) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session must be live to send messages' }),
      };
    }

    // Validate session has startedAt timestamp
    if (!session.startedAt) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session has no startedAt timestamp' }),
      };
    }

    // Calculate session-relative time
    const sessionRelativeTime = calculateSessionRelativeTime(session.startedAt, body.sentAt);

    // Build ChatMessage object
    const message: ChatMessage = {
      messageId: body.messageId,
      sessionId,
      senderId: body.senderId,
      content: body.content,
      sentAt: body.sentAt,
      sessionRelativeTime,
      senderAttributes: body.senderAttributes || {},
    };

    // Persist message and increment messageCount atomically
    await persistMessage(tableName, message);

    // Increment messageCount on session record
    const docClient = getDocumentClient();
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: `SESSION#${sessionId}`,
        SK: 'METADATA',
      },
      UpdateExpression: 'SET messageCount = if_not_exists(messageCount, :zero) + :inc',
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
      },
    }));

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        messageId: message.messageId,
        sessionRelativeTime,
      }),
    };
  } catch (error: any) {
    console.error('Error persisting message:', { sessionId, error });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to persist message' }),
    };
  }
};
