/**
 * POST /admin/appeals/{sessionId}/review
 * Admin-only endpoint to approve or deny an appeal for a killed session.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { QueryCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-review-appeal' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  // 1. Check admin auth
  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  // 2. Parse sessionId and body
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  let action: string;
  let notes: string | undefined;
  try {
    const body = JSON.parse(event.body ?? '{}');
    action = body.action;
    notes = body.notes;
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  if (action !== 'approve' && action !== 'deny') {
    return resp(400, { error: "action must be 'approve' or 'deny'" });
  }

  try {
    const docClient = getDocumentClient();

    // 3. Query the APPEAL# record for this session
    const appealResult = await docClient.send(
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

    const appeal = (appealResult.Items ?? [])[0];
    if (!appeal) {
      return resp(404, { error: 'No appeal found for this session' });
    }

    if (appeal.status !== 'pending') {
      return resp(409, { error: `Appeal has already been reviewed (status: ${appeal.status})` });
    }

    // 4. Update appeal status
    const reviewedAt = new Date().toISOString();
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: appeal.PK, SK: appeal.SK },
        UpdateExpression: 'SET #status = :status, reviewedBy = :reviewedBy, reviewedAt = :reviewedAt, reviewNotes = :notes',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': action === 'approve' ? 'approved' : 'denied',
          ':reviewedBy': adminUserId,
          ':reviewedAt': reviewedAt,
          ':notes': notes ?? null,
        },
      }),
    );

    // 5. Write audit record
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: `MOD#${reviewedAt}#${uuidv4()}`,
          entityType: 'MODERATION',
          actionType: 'APPEAL_REVIEWED',
          actorId: adminUserId,
          reason: `Appeal ${action === 'approve' ? 'approved' : 'denied'}${notes ? `: ${notes}` : ''}`,
          sessionId,
          createdAt: reviewedAt,
          appealAction: action,
          GSI5PK: 'MODERATION',
          GSI5SK: reviewedAt,
        },
      }),
    );

    logger.info('Appeal reviewed', { sessionId, action, adminUserId });

    return resp(200, { message: `Appeal ${action === 'approve' ? 'approved' : 'denied'}`, sessionId, action });
  } catch (err: any) {
    logger.error('Error reviewing appeal', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
