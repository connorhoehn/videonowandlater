import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { Logger } from '@aws-lambda-powertools/logger';
import type { SessionEvent } from '../domain/session-event';

const logger = new Logger({ serviceName: 'vnl-repository' });

export async function writeSessionEvent(
  tableName: string,
  event: SessionEvent,
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${event.sessionId}`,
      SK: `EVENT#${event.timestamp}#${event.eventId}`,
      entityType: 'SESSION_EVENT',
      ...event,
    },
  }));
}

export async function getSessionEvents(
  tableName: string,
  sessionId: string,
  limit?: number,
): Promise<SessionEvent[]> {
  const docClient = getDocumentClient();
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'EVENT#',
    },
    ScanIndexForward: true,
    ...(limit && { Limit: limit }),
  }));
  return (result.Items ?? []).map(({ PK, SK, entityType, ...event }) => event as SessionEvent);
}
