/**
 * Session repository - session persistence operations
 */

import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { Session } from '../domain/session';

/**
 * Create a new session in DynamoDB
 *
 * @param tableName DynamoDB table name
 * @param session Session object to store
 */
export async function createSession(tableName: string, session: Session): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${session.sessionId}`,
      SK: 'METADATA',
      GSI1PK: `STATUS#${session.status.toUpperCase()}`,
      GSI1SK: session.createdAt,
      entityType: 'SESSION',
      ...session,
    },
  }));
}

/**
 * Get a session by ID
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to retrieve
 * @returns Session object if found, null otherwise
 */
export async function getSessionById(tableName: string, sessionId: string): Promise<Session | null> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
  }));

  if (!result.Item) {
    return null;
  }

  // Extract session fields (remove DynamoDB keys)
  const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = result.Item;
  return session as Session;
}
