/**
 * Chat repository - message persistence operations
 */

import { PutCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { ChatMessage } from '../domain/chat-message';

const logger = new Logger({ serviceName: 'vnl-repository' });

/**
 * Store a chat message in DynamoDB
 *
 * @param tableName DynamoDB table name
 * @param message ChatMessage object to persist
 */
export async function persistMessage(tableName: string, message: ChatMessage): Promise<void> {
  const docClient = getDocumentClient();

  try {
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `MESSAGE#${message.sessionId}`,
        SK: `${message.sentAt}#${message.messageId}`,
        entityType: 'MESSAGE',
        ...message,
      },
    }));
  } catch (error) {
    logger.error('Error persisting message', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Retrieve chat history for a session
 * Returns messages in oldest-first order for UI display
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param limit Maximum number of messages (default 50)
 * @returns Array of ChatMessage objects, oldest first
 */
export async function getMessageHistory(
  tableName: string,
  sessionId: string,
  limit: number = 50
): Promise<ChatMessage[]> {
  const docClient = getDocumentClient();

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `MESSAGE#${sessionId}`,
      },
      ScanIndexForward: false, // Descending order (newest first)
      Limit: limit,
    }));

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    // Reverse to get oldest-first for UI display
    const messages = result.Items.map((item) => {
      const { PK, SK, entityType, ...message } = item;
      return message as ChatMessage;
    }).reverse();

    return messages;
  } catch (error) {
    logger.error('Error getting message history', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Retrieve a single message by ID
 * Used for verification and debugging
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param messageId Message ID
 * @param sentAt Message sent timestamp
 * @returns ChatMessage object if found, null otherwise
 */
export async function getMessageById(
  tableName: string,
  sessionId: string,
  sentAt: string,
  messageId: string
): Promise<ChatMessage | null> {
  const docClient = getDocumentClient();

  try {
    const result = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: {
        PK: `MESSAGE#${sessionId}`,
        SK: `${sentAt}#${messageId}`,
      },
    }));

    if (!result.Item) {
      return null;
    }

    const { PK, SK, entityType, ...message } = result.Item;
    return message as ChatMessage;
  } catch (error) {
    logger.error('Error getting message by ID', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
