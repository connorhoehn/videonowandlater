/**
 * GET /admin/sessions/{sessionId}/detail
 * Admin-only endpoint to get comprehensive session data including costs,
 * participants, and moderation history.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById, getHangoutParticipants } from '../repositories/session-repository';
import { getCostSummary, getCostLineItems } from '../repositories/cost-repository';
import { getContextEvents } from '../repositories/context-repository';
import { getIntentFlow, getIntentResults } from '../repositories/intent-repository';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-get-session-detail' } });

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

  // 2. Parse sessionId
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  try {
    // 3. Get session
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    // 4. Fetch cost summary and line items
    const [costSummary, costLineItems] = await Promise.all([
      getCostSummary(tableName, sessionId),
      getCostLineItems(tableName, sessionId),
    ]);

    // 5. Get participants + context events + intent data
    const [participants, contextEvents, intentResults] = await Promise.all([
      getHangoutParticipants(tableName, sessionId),
      getContextEvents(tableName, sessionId),
      getIntentResults(tableName, sessionId),
    ]);

    const intentFlow = session.intentFlowId
      ? await getIntentFlow(tableName, sessionId, session.intentFlowId)
      : null;

    // 6. Get moderation history
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

    const moderationHistory = (modResult.Items ?? []).map((item) => ({
      actionType: item.actionType,
      actorId: item.actorId,
      reason: item.reason,
      createdAt: item.createdAt,
      sessionType: item.sessionType,
      reviewStatus: item.reviewStatus,
      reviewedBy: item.reviewedBy,
      reviewedAt: item.reviewedAt,
      reviewNotes: item.reviewNotes,
      reviewAction: item.reviewAction,
    }));

    logger.info('Session detail retrieved', { sessionId });

    // 7. Return combined data
    return resp(200, {
      session,
      cost: {
        summary: costSummary,
        lineItems: costLineItems,
      },
      participants,
      moderationHistory,
      contextEvents,
      intentFlow,
      intentResults,
    });
  } catch (err: any) {
    logger.error('Error getting session detail', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
