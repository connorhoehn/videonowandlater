/**
 * POST/DELETE /sessions/{sessionId}/rsvp
 *
 * Phase 5: scheduled sessions. Idempotent RSVP creation/removal for a SCHEDULED
 * session. RSVPs for non-scheduled sessions return 400.
 *
 * Storage:
 *   PK: SESSION#<id>       SK: RSVP#<userId>
 *   GSI1PK: RSVP_BY#<userId>  GSI1SK: <scheduledFor>   (caller's upcoming events)
 *
 * Body on POST: { status: 'going' | 'interested' }.
 * Response:     { status, goingCount, interestedCount }.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutCommand, DeleteCommand, GetCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { SessionStatus } from '../domain/session';
import { getSessionById } from '../repositories/session-repository';
import { getDocumentClient } from '../lib/dynamodb-client';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'rsvp-session' } });

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

type RsvpStatus = 'going' | 'interested';

async function countRsvps(
  tableName: string,
  sessionId: string,
): Promise<{ going: number; interested: number }> {
  const docClient = getDocumentClient();
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'RSVP#',
    },
  }));
  let going = 0;
  let interested = 0;
  for (const item of result.Items ?? []) {
    if (item.status === 'going') going++;
    else if (item.status === 'interested') interested++;
  }
  return { going, interested };
}

async function updateRsvpCounts(
  tableName: string,
  sessionId: string,
  going: number,
  interested: number,
): Promise<void> {
  const docClient = getDocumentClient();
  try {
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #g = :g, #i = :i',
      ExpressionAttributeNames: { '#g': 'rsvpGoingCount', '#i': 'rsvpInterestedCount' },
      ExpressionAttributeValues: { ':g': going, ':i': interested },
    }));
  } catch (err: any) {
    logger.warn('Failed to update denormalized RSVP counts (non-blocking)', {
      sessionId,
      error: err.message,
    });
  }
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  const session = await getSessionById(tableName, sessionId);
  if (!session) return resp(404, { error: 'Session not found' });

  if (session.status !== SessionStatus.SCHEDULED) {
    return resp(400, { error: 'RSVPs are only allowed on SCHEDULED sessions' });
  }

  const docClient = getDocumentClient();
  const method = event.httpMethod;

  if (method === 'DELETE') {
    // Idempotent un-RSVP: ignore missing record.
    const existing = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: `RSVP#${userId}` },
    }));

    if (existing.Item) {
      await docClient.send(new DeleteCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${sessionId}`, SK: `RSVP#${userId}` },
      }));

      try {
        await emitSessionEvent(tableName, {
          eventId: uuidv4(),
          sessionId,
          eventType: SessionEventType.RSVP_REMOVED,
          timestamp: new Date().toISOString(),
          actorId: userId,
          actorType: 'user',
        });
      } catch { /* non-blocking */ }
    }

    const counts = await countRsvps(tableName, sessionId);
    await updateRsvpCounts(tableName, sessionId, counts.going, counts.interested);
    return resp(200, { status: null, goingCount: counts.going, interestedCount: counts.interested });
  }

  // POST — create or update RSVP
  let body: { status?: RsvpStatus };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  if (!body.status || (body.status !== 'going' && body.status !== 'interested')) {
    return resp(400, { error: "status must be 'going' or 'interested'" });
  }

  const rsvpAt = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `RSVP#${userId}`,
      entityType: 'RSVP',
      userId,
      sessionId,
      rsvpAt,
      status: body.status,
      // Per-user "my upcoming events" lookup, ordered by start time.
      GSI1PK: `RSVP_BY#${userId}`,
      GSI1SK: session.scheduledFor ?? rsvpAt,
    },
  }));

  try {
    await emitSessionEvent(tableName, {
      eventId: uuidv4(),
      sessionId,
      eventType: SessionEventType.RSVP_CREATED,
      timestamp: rsvpAt,
      actorId: userId,
      actorType: 'user',
      details: { rsvpStatus: body.status },
    });
  } catch { /* non-blocking */ }

  const counts = await countRsvps(tableName, sessionId);
  await updateRsvpCounts(tableName, sessionId, counts.going, counts.interested);

  return resp(200, {
    status: body.status,
    goingCount: counts.going,
    interestedCount: counts.interested,
  });
};
