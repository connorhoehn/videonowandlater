/**
 * POST /sessions handler - create new session by claiming pool resources
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SessionType } from '../domain/session';
import { createNewSession } from '../services/session-service';
import { createStorySession } from '../repositories/story-repository';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getCurrentVersion } from '../repositories/ruleset-repository';
import { v4 as uuidv4 } from 'uuid';

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];

  if (!userId) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // Parse request body
  let body: {
    sessionType: SessionType;
    requireApproval?: boolean;
    moderationEnabled?: boolean;
    rulesetName?: string;
  };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  if (!body.sessionType || !['BROADCAST', 'HANGOUT', 'STORY'].includes(body.sessionType)) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'sessionType required (BROADCAST, HANGOUT, or STORY)' }),
    };
  }

  // STORY sessions don't need IVS resources — use dedicated story path
  if (body.sessionType === SessionType.STORY) {
    const session = await createStorySession(tableName, userId);

    try {
      await emitSessionEvent(tableName, {
        eventId: uuidv4(), sessionId: session.sessionId, eventType: SessionEventType.SESSION_CREATED,
        timestamp: new Date().toISOString(), actorId: userId,
        actorType: 'user', details: { sessionType: body.sessionType },
      });
    } catch { /* non-blocking */ }

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(session),
    };
  }

  // Phase 4: pin ruleset version at session start if moderation enabled
  let rulesetName: string | undefined;
  let rulesetVersion: number | undefined;
  if (body.moderationEnabled && body.rulesetName) {
    try {
      const version = await getCurrentVersion(tableName, body.rulesetName);
      if (version === null) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: `Unknown ruleset: ${body.rulesetName}` }),
        };
      }
      rulesetName = body.rulesetName;
      rulesetVersion = version;
    } catch (err) {
      // Non-blocking: fail closed only on validation error above; treat loader errors as soft-fail
    }
  }

  const result = await createNewSession(tableName, {
    userId,
    sessionType: body.sessionType,
    moderationEnabled: Boolean(body.moderationEnabled && rulesetName && rulesetVersion !== undefined),
    rulesetName,
    rulesetVersion,
  });

  if (result.error) {
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Retry-After': '60',
      },
      body: JSON.stringify({ error: result.error }),
    };
  }

  // Phase 2: Hangout lobbies — persist requireApproval flag on HANGOUT sessions
  const requireApproval = body.requireApproval === true && body.sessionType === SessionType.HANGOUT;
  if (requireApproval) {
    try {
      await getDocumentClient().send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${result.sessionId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #requireApproval = :val',
        ExpressionAttributeNames: { '#requireApproval': 'requireApproval' },
        ExpressionAttributeValues: { ':val': true },
      }));
    } catch { /* non-blocking, default is no approval */ }
  }

  try {
    await emitSessionEvent(tableName, {
      eventId: uuidv4(), sessionId: result.sessionId, eventType: SessionEventType.SESSION_CREATED,
      timestamp: new Date().toISOString(), actorId: userId,
      actorType: 'user', details: { sessionType: body.sessionType, requireApproval },
    });
  } catch { /* non-blocking */ }

  return {
    statusCode: 201,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ ...result, requireApproval }),
  };
};
