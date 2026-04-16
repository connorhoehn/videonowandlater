import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { Logger } from '@aws-lambda-powertools/logger';
import { v4 as uuidv4 } from 'uuid';
import type { AgentStatus } from '../domain/context-event';

const logger = new Logger({ serviceName: 'vnl-repository' });

export async function updateAgentStatus(
  tableName: string,
  sessionId: string,
  agentStatus: AgentStatus,
  agentParticipantId?: string,
  agentTaskArn?: string,
): Promise<void> {
  const docClient = getDocumentClient();

  let updateExpr = 'SET agentStatus = :status';
  const exprValues: Record<string, any> = { ':status': agentStatus };

  if (agentParticipantId) {
    updateExpr += ', agentParticipantId = :pid';
    exprValues[':pid'] = agentParticipantId;
  }
  if (agentTaskArn) {
    updateExpr += ', agentTaskArn = :taskArn';
    exprValues[':taskArn'] = agentTaskArn;
  }

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    UpdateExpression: updateExpr,
    ExpressionAttributeValues: exprValues,
  }));
}

export async function writeAgentAuditRecord(
  tableName: string,
  sessionId: string,
  action: 'join' | 'leave' | 'speak' | 'intent_extracted' | 'error',
  details?: Record<string, any>,
): Promise<void> {
  const docClient = getDocumentClient();
  const now = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `AGENT_AUDIT#${now}#${uuidv4()}`,
      entityType: 'AGENT_AUDIT',
      GSI5PK: 'AGENT_AUDIT',
      GSI5SK: now,
      sessionId,
      action,
      details: details ?? {},
      createdAt: now,
    },
  }));
}
