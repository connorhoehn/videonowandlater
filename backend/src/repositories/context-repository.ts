import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { Logger } from '@aws-lambda-powertools/logger';
import type { ContextEvent } from '../domain/context-event';

const logger = new Logger({ serviceName: 'vnl-repository' });

function zeroPad(ms: number): string {
  return String(ms).padStart(12, '0');
}

export async function addContextEvent(
  tableName: string,
  sessionId: string,
  event: ContextEvent,
): Promise<void> {
  const docClient = getDocumentClient();
  const dateOnly = event.createdAt.split('T')[0];

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `CTX#${zeroPad(event.timestamp)}#${event.contextId}`,
      entityType: 'CONTEXT_EVENT',
      GSI5PK: `CONTEXT#DAILY#${dateOnly}`,
      GSI5SK: `${sessionId}#${event.contextId}`,
      ...event,
    },
  }));
}

export async function getContextEvents(
  tableName: string,
  sessionId: string,
): Promise<ContextEvent[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'CTX#',
    },
    ScanIndexForward: true,
  }));

  return (result.Items ?? []).map(({ PK, SK, entityType, GSI5PK, GSI5SK, ...event }) => event as ContextEvent);
}

export async function getContextEventsByTimeRange(
  tableName: string,
  sessionId: string,
  startMs: number,
  endMs: number,
): Promise<ContextEvent[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':start': `CTX#${zeroPad(startMs)}`,
      ':end': `CTX#${zeroPad(endMs)}#\uffff`,
    },
    ScanIndexForward: true,
  }));

  return (result.Items ?? []).map(({ PK, SK, entityType, GSI5PK, GSI5SK, ...event }) => event as ContextEvent);
}
