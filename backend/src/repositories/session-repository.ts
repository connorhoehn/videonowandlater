/**
 * Session repository - session persistence operations
 */

import { PutCommand, GetCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { Session } from '../domain/session';
import { SessionStatus, RecordingStatus } from '../domain/session';

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
  const { canTransition } = await import('../domain/session.js');
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

/**
 * Update session recording metadata fields
 * Supports partial updates of recording-related fields
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to update
 * @param metadata Partial recording metadata to update
 */
export async function updateRecordingMetadata(
  tableName: string,
  sessionId: string,
  metadata: {
    recordingS3Path?: string;
    recordingDuration?: number;
    thumbnailUrl?: string;
    recordingHlsUrl?: string;
    recordingStatus?: RecordingStatus | 'processing' | 'available' | 'failed' | 'pending';
  }
): Promise<void> {
  const docClient = getDocumentClient();

  // Build dynamic update expression for provided fields only
  const updateParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {
    '#version': 'version',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':inc': 1,
  };

  if (metadata.recordingS3Path !== undefined) {
    updateParts.push('#recordingS3Path = :recordingS3Path');
    expressionAttributeNames['#recordingS3Path'] = 'recordingS3Path';
    expressionAttributeValues[':recordingS3Path'] = metadata.recordingS3Path;
  }

  if (metadata.recordingDuration !== undefined) {
    updateParts.push('#recordingDuration = :recordingDuration');
    expressionAttributeNames['#recordingDuration'] = 'recordingDuration';
    expressionAttributeValues[':recordingDuration'] = metadata.recordingDuration;
  }

  if (metadata.thumbnailUrl !== undefined) {
    updateParts.push('#thumbnailUrl = :thumbnailUrl');
    expressionAttributeNames['#thumbnailUrl'] = 'thumbnailUrl';
    expressionAttributeValues[':thumbnailUrl'] = metadata.thumbnailUrl;
  }

  if (metadata.recordingHlsUrl !== undefined) {
    updateParts.push('#recordingHlsUrl = :recordingHlsUrl');
    expressionAttributeNames['#recordingHlsUrl'] = 'recordingHlsUrl';
    expressionAttributeValues[':recordingHlsUrl'] = metadata.recordingHlsUrl;
  }

  if (metadata.recordingStatus !== undefined) {
    updateParts.push('#recordingStatus = :recordingStatus');
    expressionAttributeNames['#recordingStatus'] = 'recordingStatus';
    expressionAttributeValues[':recordingStatus'] = metadata.recordingStatus;
  }

  if (updateParts.length === 0) {
    // No fields to update
    return;
  }

  const updateExpression = `SET ${updateParts.join(', ')}, #version = #version + :inc`;

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }));
}

/**
 * Get recently recorded sessions
 * Returns sessions with recordingStatus='available' sorted by endedAt descending
 *
 * @param tableName DynamoDB table name
 * @param limit Maximum number of recordings to return (default 20)
 * @returns Array of Session objects with available recordings
 */
export async function getRecentRecordings(
  tableName: string,
  limit: number = 20
): Promise<Session[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'recordingStatus = :available AND begins_with(PK, :pk)',
    ExpressionAttributeValues: {
      ':available': 'available',
      ':pk': 'SESSION#',
    },
  }));

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  // Extract session fields (remove DynamoDB keys) and filter sessions with endedAt
  const sessions = result.Items
    .filter(item => item.endedAt !== undefined)
    .map(item => {
      const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
      return session as Session;
    });

  // Sort descending by endedAt (most recent first)
  sessions.sort((a, b) => {
    const aTime = new Date(a.endedAt!).getTime();
    const bTime = new Date(b.endedAt!).getTime();
    return bTime - aTime;
  });

  // Return limited number of recordings
  return sessions.slice(0, limit);
}

/**
 * Find session by Stage ARN
 * Used by recording-ended handler to map EventBridge events to sessions
 *
 * @param tableName DynamoDB table name
 * @param stageArn IVS RealTime Stage ARN to search for
 * @returns Session object if found, null otherwise
 */
export async function findSessionByStageArn(
  tableName: string,
  stageArn: string
): Promise<Session | null> {
  const docClient = getDocumentClient();

  // Use Scan with FilterExpression (no GSI available for claimedResources.stage)
  // This is acceptable for low-frequency queries (recording-ended events only)
  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'begins_with(PK, :pkPrefix) AND claimedResources.stage = :stageArn',
    ExpressionAttributeValues: {
      ':pkPrefix': 'SESSION#',
      ':stageArn': stageArn,
    },
  }));

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  // Return first matching session (Stage ARNs are unique per session)
  const item = result.Items[0];
  const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
  return session as Session;
}
