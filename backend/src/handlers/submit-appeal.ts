/**
 * POST /sessions/{sessionId}/appeal
 * Regular user endpoint — submit an appeal for a killed session.
 * Max 1 appeal per session, within 7 days of the kill.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'submit-appeal' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  // Parse and validate body
  let reason: string;
  try {
    const body = JSON.parse(event.body ?? '{}');
    reason = body.reason;
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    return resp(400, { error: 'reason is required and must be at least 10 characters' });
  }
  reason = reason.trim();

  try {
    // 1. Verify session exists and user is owner
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    if (session.userId !== userId) return resp(403, { error: 'Forbidden: you are not the session owner' });

    // 2. Verify session was killed (has a MOD# record with ADMIN_KILL or ML_AUTO_KILL)
    const docClient = getDocumentClient();
    const modResult = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `SESSION#${sessionId}`,
          ':skPrefix': 'MOD#',
        },
        ScanIndexForward: false,
      }),
    );

    const killRecord = (modResult.Items ?? []).find(
      (item) => item.actionType === 'ADMIN_KILL' || item.actionType === 'ML_AUTO_KILL',
    );

    if (!killRecord) {
      return resp(400, { error: 'Session was not killed — appeals are only for killed sessions' });
    }

    // 3. Verify appeal is within 7 days of the kill
    const killDate = new Date(killRecord.createdAt).getTime();
    if (Date.now() - killDate > SEVEN_DAYS_MS) {
      return resp(400, { error: 'Appeal window has expired (7 days from kill date)' });
    }

    // 4. Check for existing appeal — max 1 per session
    const existingAppeals = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `SESSION#${sessionId}`,
          ':skPrefix': 'APPEAL#',
        },
        Limit: 1,
      }),
    );

    if ((existingAppeals.Items ?? []).length > 0) {
      return resp(409, { error: 'An appeal has already been submitted for this session' });
    }

    // 5. Write appeal record
    const createdAt = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: `APPEAL#${createdAt}#${uuidv4()}`,
          entityType: 'APPEAL',
          sessionId,
          userId,
          reason,
          status: 'pending',
          createdAt,
          GSI5PK: 'APPEAL',
          GSI5SK: createdAt,
        },
      }),
    );

    logger.info('Appeal submitted', { sessionId, userId });

    return resp(200, { message: 'Appeal submitted', sessionId });
  } catch (err: any) {
    logger.error('Error submitting appeal', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
