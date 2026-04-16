/**
 * GET /admin/audit-log
 * Admin-only endpoint to list recent moderation actions.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-audit-log' } });

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

  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  try {
    const params = event.queryStringParameters ?? {};
    const limit = Math.min(parseInt(params.limit ?? '50', 10) || 50, 200);
    const since = params.since; // Optional ISO date filter
    const type = params.type ?? 'moderation'; // 'moderation' | 'appeal' | 'agent'

    const gsi5pk = type === 'agent' ? 'AGENT_AUDIT' : type === 'appeal' ? 'APPEAL' : 'MODERATION';

    const docClient = getDocumentClient();

    const queryParams: any = {
      TableName: tableName,
      IndexName: 'GSI5',
      KeyConditionExpression: since
        ? 'GSI5PK = :pk AND GSI5SK >= :since'
        : 'GSI5PK = :pk',
      ExpressionAttributeValues: {
        ':pk': gsi5pk,
        ...(since ? { ':since': since } : {}),
      },
      Limit: limit,
      ScanIndexForward: false, // newest first
    };

    const result = await docClient.send(new QueryCommand(queryParams));

    const entries = (result.Items ?? []).map((item) => ({
      sessionId: item.sessionId,
      actionType: item.actionType,
      actorId: item.actorId,
      reason: item.reason,
      createdAt: item.createdAt,
      sessionType: item.sessionType,
      // Appeal-specific fields
      ...(type === 'appeal' ? {
        entityType: item.entityType,
        userId: item.userId,
        status: item.status,
        reviewedBy: item.reviewedBy,
        reviewedAt: item.reviewedAt,
        reviewNotes: item.reviewNotes,
      } : {}),
      // Agent-specific fields
      ...(type === 'agent' ? {
        agentId: item.agentId,
        agentStatus: item.agentStatus,
        intentSlot: item.intentSlot,
        value: item.value,
        confidence: item.confidence,
        utterance: item.utterance,
      } : {}),
    }));

    logger.info('Listed audit log', { count: entries.length });

    return resp(200, { entries });
  } catch (err: any) {
    logger.error('Error listing audit log', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
