/**
 * POST /sessions/{id}/go-live
 *
 * Phase 5: scheduled sessions. Transitions a SCHEDULED session to CREATING,
 * claims pool resources (via shared session-service helper), persists them,
 * and emits SESSION_CREATED so the rest of the pipeline continues normally.
 *
 * Owner-only. 400 if the session is not in SCHEDULED state. Mirrors the
 * response shape of POST /sessions (sessionId, sessionType, status).
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { SessionStatus, SessionType } from '../domain/session';
import { getSessionById } from '../repositories/session-repository';
import { getDocumentClient } from '../lib/dynamodb-client';
import { claimSessionResources } from '../services/session-service';
import { emitSessionEvent } from '../lib/emit-session-event';
import { startAdsSession } from '../lib/ad-service-client';
import { SessionEventType } from '../domain/session-event';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'go-live' } });

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

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  const session = await getSessionById(tableName, sessionId);
  if (!session) return resp(404, { error: 'Session not found' });

  if (session.userId !== userId) return resp(403, { error: 'Only the session owner can go live' });

  if (session.status !== SessionStatus.SCHEDULED) {
    return resp(400, {
      error: `Session must be in SCHEDULED state to go live (current: ${session.status})`,
    });
  }

  if (session.sessionType !== SessionType.BROADCAST && session.sessionType !== SessionType.HANGOUT) {
    return resp(400, { error: 'Only BROADCAST and HANGOUT sessions can go live' });
  }

  // Claim pool resources via shared helper
  const claim = await claimSessionResources(tableName, sessionId, session.sessionType);
  if (claim.error) {
    return {
      statusCode: 503,
      headers: { ...CORS, 'Retry-After': '60' },
      body: JSON.stringify({ error: claim.error }),
    };
  }

  // Atomic transition SCHEDULED → CREATING with claimed resources persisted.
  // Uses conditional check on current status so concurrent go-live calls fail cleanly.
  const docClient = getDocumentClient();
  try {
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: [
        'SET #status = :creating',
        'GSI1PK = :gsiPk',
        'GSI1SK = :gsiSk',
        '#claimed = :claimed',
        ...(claim.channelArn ? ['#channelArn = :channelArn'] : []),
        ...(claim.stageArn ? ['#stageArn = :stageArn'] : []),
        '#version = #version + :inc',
      ].join(', '),
      ConditionExpression: '#status = :scheduled',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#claimed': 'claimedResources',
        '#version': 'version',
        ...(claim.channelArn ? { '#channelArn': 'channelArn' } : {}),
        ...(claim.stageArn ? { '#stageArn': 'stageArn' } : {}),
      },
      ExpressionAttributeValues: {
        ':creating': SessionStatus.CREATING,
        ':scheduled': SessionStatus.SCHEDULED,
        ':gsiPk': `STATUS#${SessionStatus.CREATING.toUpperCase()}`,
        ':gsiSk': session.createdAt,
        ':claimed': {
          channel: claim.channelArn,
          stage: claim.stageArn,
          chatRoom: claim.chatRoomArn,
        },
        ':inc': 1,
        ...(claim.channelArn ? { ':channelArn': claim.channelArn } : {}),
        ...(claim.stageArn ? { ':stageArn': claim.stageArn } : {}),
      },
    }));
  } catch (err: any) {
    logger.error('Failed transitioning SCHEDULED → CREATING', { error: err.message, sessionId });
    return resp(409, { error: 'Session is no longer in SCHEDULED state' });
  }

  // Emit SESSION_CREATED so the normal live pipeline continues (matches
  // POST /sessions behavior for immediate-live sessions).
  try {
    await emitSessionEvent(tableName, {
      eventId: uuidv4(),
      sessionId,
      eventType: SessionEventType.SESSION_CREATED,
      timestamp: new Date().toISOString(),
      actorId: userId,
      actorType: 'user',
      details: { sessionType: session.sessionType, fromScheduled: true },
    });
  } catch { /* non-blocking */ }

  // Notify vnl-ads
  void startAdsSession(sessionId, userId);

  return resp(200, {
    sessionId,
    sessionType: session.sessionType,
    status: SessionStatus.CREATING,
    claimedResources: {
      channel: claim.channelArn,
      stage: claim.stageArn,
      chatRoom: claim.chatRoomArn,
    },
  });
};
