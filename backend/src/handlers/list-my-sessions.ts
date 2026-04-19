/**
 * GET /sessions/mine?status=LIVE
 * List sessions the caller owns. Defaults to LIVE-only (no status query param);
 * pass status=LIVE|ENDING|ENDED|ALL to override.
 *
 * Any authenticated user. Filters by `userId === caller` client-side over the
 * STATUS#<X> partition — cheap because STATUS#LIVE is small (auto-kill cron
 * caps it) and STATUS#ENDED is typically TTL'd/aged out.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'list-my-sessions' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const VALID_STATUSES = ['LIVE', 'ENDING', 'ENDED', 'ALL'] as const;
type StatusFilter = (typeof VALID_STATUSES)[number];

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const requested = (event.queryStringParameters?.status ?? 'LIVE').toUpperCase() as StatusFilter;
  if (!VALID_STATUSES.includes(requested)) {
    return resp(400, { error: `Invalid status. Use one of: ${VALID_STATUSES.join(', ')}` });
  }

  const statusesToQuery: Exclude<StatusFilter, 'ALL'>[] =
    requested === 'ALL' ? ['LIVE', 'ENDING', 'ENDED'] : [requested];

  try {
    const docClient = getDocumentClient();

    const results = await Promise.all(
      statusesToQuery.map((status) =>
        docClient.send(new QueryCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :status',
          ExpressionAttributeValues: { ':status': `STATUS#${status}` },
          ScanIndexForward: false,
        })),
      ),
    );

    const allItems = results.flatMap((r) => r.Items ?? []);

    const sessions = allItems
      .filter((item) => item.userId === userId)
      .map((item) => ({
        sessionId: item.sessionId,
        userId: item.userId,
        sessionType: item.sessionType,
        status: item.status,
        createdAt: item.createdAt,
        endedAt: item.endedAt,
        participantCount: item.participantCount ?? 0,
        messageCount: item.messageCount ?? 0,
      }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

    return resp(200, { sessions });
  } catch (err: any) {
    logger.error('Error listing my sessions', { userId, error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
