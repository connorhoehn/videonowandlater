/**
 * GET /me/rsvps?upcoming=1
 *
 * Phase 5: scheduled sessions. Returns sessions the caller has RSVP'd to,
 * joined with session metadata (title, scheduledFor, status, etc.).
 *
 * Uses GSI1 with PK=RSVP_BY#<userId>, sorted by scheduledFor.
 * upcoming=1 filters out sessions whose scheduledFor is in the past.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};
const resp = (statusCode: number, body: object): APIGatewayProxyResult => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(body),
});

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const upcoming = event.queryStringParameters?.upcoming === '1'
    || event.queryStringParameters?.upcoming === 'true';

  const docClient = getDocumentClient();

  // Step 1: look up RSVP records via GSI1 (RSVP_BY#<userId>, ordered by scheduledFor asc)
  const rsvpResult = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `RSVP_BY#${userId}` },
  }));

  const rsvpRows = rsvpResult.Items ?? [];
  if (rsvpRows.length === 0) {
    return resp(200, { rsvps: [] });
  }

  // Step 2: batch-get the referenced session metadata
  const sessionKeys = rsvpRows
    .map((r) => r.sessionId)
    .filter((id, idx, arr) => arr.indexOf(id) === idx)
    .map((sessionId) => ({ PK: `SESSION#${sessionId}`, SK: 'METADATA' }));

  const sessionMap: Record<string, any> = {};
  // BatchGet caps at 100 items per request — paginate if needed.
  for (let i = 0; i < sessionKeys.length; i += 100) {
    const slice = sessionKeys.slice(i, i + 100);
    const batch = await docClient.send(new BatchGetCommand({
      RequestItems: { [tableName]: { Keys: slice } },
    }));
    for (const item of (batch.Responses?.[tableName] ?? [])) {
      sessionMap[item.sessionId] = item;
    }
  }

  const nowMs = Date.now();
  const rsvps = rsvpRows
    .map((r) => {
      const s = sessionMap[r.sessionId];
      if (!s) return null;
      return {
        sessionId: r.sessionId,
        rsvpStatus: r.status,
        rsvpAt: r.rsvpAt,
        sessionStatus: s.status,
        scheduledFor: s.scheduledFor,
        scheduledEndsAt: s.scheduledEndsAt,
        title: s.title,
        description: s.description,
        coverImageUrl: s.coverImageUrl,
        hostUserId: s.userId,
        sessionType: s.sessionType,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .filter((x) => {
      if (!upcoming) return true;
      if (!x.scheduledFor) return false;
      return Date.parse(x.scheduledFor) >= nowMs;
    })
    .sort((a, b) => {
      const aMs = a.scheduledFor ? Date.parse(a.scheduledFor) : 0;
      const bMs = b.scheduledFor ? Date.parse(b.scheduledFor) : 0;
      return aMs - bMs;
    });

  return resp(200, { rsvps });
};
