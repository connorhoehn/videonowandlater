/**
 * GET /admin/sessions
 * Admin-only endpoint to list all active (LIVE and ENDING) sessions.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-list-sessions' } });

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
    const docClient = getDocumentClient();

    // Query LIVE and ENDING sessions in parallel via GSI1
    const [liveResult, endingResult] = await Promise.all([
      docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :status',
        ExpressionAttributeValues: { ':status': 'STATUS#LIVE' },
        ScanIndexForward: false,
      })),
      docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :status',
        ExpressionAttributeValues: { ':status': 'STATUS#ENDING' },
        ScanIndexForward: false,
      })),
    ]);

    const allItems = [
      ...(liveResult.Items ?? []),
      ...(endingResult.Items ?? []),
    ];

    // Map to response shape and sort by createdAt desc
    const sessions = allItems
      .map((item) => ({
        sessionId: item.sessionId,
        userId: item.userId,
        sessionType: item.sessionType,
        status: item.status,
        createdAt: item.createdAt,
        participantCount: item.participantCount ?? 0,
        messageCount: item.messageCount ?? 0,
      }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

    logger.info('Listed active sessions', { count: sessions.length });

    return resp(200, { sessions });
  } catch (err: any) {
    logger.error('Error listing sessions', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
