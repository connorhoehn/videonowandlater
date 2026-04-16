import { PutCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { Logger } from '@aws-lambda-powertools/logger';
import type { IntentFlow, IntentResult } from '../domain/context-event';

const logger = new Logger({ serviceName: 'vnl-repository' });

export async function createIntentFlow(
  tableName: string,
  sessionId: string,
  flow: IntentFlow,
): Promise<void> {
  const docClient = getDocumentClient();

  // Store the intent flow
  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `INTENT_FLOW#${flow.flowId}`,
      entityType: 'INTENT_FLOW',
      ...flow,
    },
  }));

  // Update session METADATA with intentFlowId
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
    UpdateExpression: 'SET intentFlowId = :flowId',
    ExpressionAttributeValues: { ':flowId': flow.flowId },
  }));
}

export async function getIntentFlow(
  tableName: string,
  sessionId: string,
  flowId?: string,
): Promise<IntentFlow | null> {
  const docClient = getDocumentClient();

  if (flowId) {
    const result = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: `INTENT_FLOW#${flowId}` },
    }));
    if (!result.Item) return null;
    const { PK, SK, entityType, ...flow } = result.Item;
    return flow as IntentFlow;
  }

  // Find the first (most recent) intent flow for this session
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'INTENT_FLOW#',
    },
    ScanIndexForward: false,
    Limit: 1,
  }));

  if (!result.Items || result.Items.length === 0) return null;
  const { PK, SK, entityType, ...flow } = result.Items[0];
  return flow as IntentFlow;
}

export async function updateIntentFlowStep(
  tableName: string,
  sessionId: string,
  flowId: string,
  stepIndex: number,
  filledValue: string,
  confidence: number,
): Promise<void> {
  const docClient = getDocumentClient();
  const now = new Date().toISOString();

  // Update the step in the inline steps array
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: `INTENT_FLOW#${flowId}` },
    UpdateExpression: `SET steps[${stepIndex}].filledValue = :val, steps[${stepIndex}].filledAt = :at, steps[${stepIndex}].confidence = :conf`,
    ExpressionAttributeValues: {
      ':val': filledValue,
      ':at': now,
      ':conf': confidence,
    },
  }));

  // Also write an INTENT_RESULT record for querying
  const flow = await getIntentFlow(tableName, sessionId, flowId);
  const step = flow?.steps[stepIndex];
  if (step) {
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: `INTENT_RESULT#${now}#${step.stepId}`,
        entityType: 'INTENT_RESULT',
        intentSlot: step.intentSlot,
        value: filledValue,
        confidence,
        extractedAt: now,
        sessionId,
      },
    }));
  }
}

export async function updateIntentFlowStatus(
  tableName: string,
  sessionId: string,
  flowId: string,
  status: IntentFlow['status'],
): Promise<void> {
  const docClient = getDocumentClient();
  const now = new Date().toISOString();

  const updateExpr = status === 'completed'
    ? 'SET #status = :status, completedAt = :now'
    : 'SET #status = :status';

  const exprValues: Record<string, any> = { ':status': status };
  if (status === 'completed') exprValues[':now'] = now;

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: `INTENT_FLOW#${flowId}` },
    UpdateExpression: updateExpr,
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: exprValues,
  }));
}

export async function getIntentResults(
  tableName: string,
  sessionId: string,
): Promise<IntentResult[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'INTENT_RESULT#',
    },
    ScanIndexForward: true,
  }));

  return (result.Items ?? []).map(({ PK, SK, entityType, ...r }) => r as IntentResult);
}
