/**
 * GET /sessions/{sessionId}/rsvps?limit=50
 *
 * Phase 5: scheduled sessions. Returns attendee list and counts for a session.
 * Public if session is public, else owner-only.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getSessionById } from '../repositories/session-repository';
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

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  const session = await getSessionById(tableName, sessionId);
  if (!session) return resp(404, { error: 'Session not found' });

  // Private sessions are owner-only.
  const caller = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (session.isPrivate && session.userId !== caller) {
    return resp(403, { error: 'Private session — attendee list is owner-only' });
  }

  const rawLimit = parseInt(event.queryStringParameters?.limit ?? '50', 10);
  const limit = Math.max(1, Math.min(Number.isNaN(rawLimit) ? 50 : rawLimit, 200));

  const docClient = getDocumentClient();
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'RSVP#',
    },
    Limit: limit,
  }));

  let going = 0;
  let interested = 0;
  const attendees: Array<{ userId: string; displayName: string; avatarUrl?: string; status: string; rsvpAt: string }> = [];
  for (const item of result.Items ?? []) {
    if (item.status === 'going') going++;
    else if (item.status === 'interested') interested++;
    attendees.push({
      userId: item.userId,
      displayName: item.userId, // no separate display name in our system
      avatarUrl: undefined,
      status: item.status,
      rsvpAt: item.rsvpAt,
    });
  }

  return resp(200, { going, interested, attendees });
};
