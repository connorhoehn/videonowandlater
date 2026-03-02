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

/**
 * Update session status with optimistic locking
 * Validates state transitions using canTransition
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param newStatus New status to set
 * @param timestampField Optional timestamp field to update (startedAt or endedAt)
 * @throws ConditionalCheckFailedException if invalid transition or version mismatch
 */
export async function updateSessionStatus(
  tableName: string,
  sessionId: string,
  newStatus: SessionStatus,
  timestampField?: 'startedAt' | 'endedAt'
): Promise<void> {
  const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const { canTransition } = await import('../domain/session');
  const docClient = getDocumentClient();

  // First get current session to validate transition
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (!canTransition(session.status, newStatus)) {
    throw new Error(`Invalid transition from ${session.status} to ${newStatus}`);
  }

  const updateExpression = timestampField
    ? `SET #status = :newStatus, #timestamp = :now, GSI1PK = :gsi, #version = #version + :inc`
    : `SET #status = :newStatus, GSI1PK = :gsi, #version = #version + :inc`;

  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
    '#version': 'version',
  };

  const expressionAttributeValues: Record<string, any> = {
    ':newStatus': newStatus,
    ':gsi': `STATUS#${newStatus.toUpperCase()}`,
    ':inc': 1,
    ':currentVersion': session.version,
  };

  if (timestampField) {
    expressionAttributeNames['#timestamp'] = timestampField;
    expressionAttributeValues[':now'] = new Date().toISOString();
  }

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: updateExpression,
    ConditionExpression: '#version = :currentVersion',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}
