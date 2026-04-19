/**
 * POST /sessions/{sessionId}/survey
 *
 * Post-call survey submission. Any authenticated user who participated in the
 * session may submit exactly one survey. Participation is detected by:
 *   - caller is the session host (session.userId), OR
 *   - caller has a PARTICIPANT# row on the session partition.
 *
 * Body: { nps: integer 0-10, freeText?: string up to 1000 chars }
 * Responses: 201 created, 400 invalid body/nps, 401 unauth, 403 not a
 * participant, 404 session not found, 409 already submitted.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getSessionById, getHangoutParticipants } from '../repositories/session-repository';
import { writeSurvey } from '../repositories/survey-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'submit-survey' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

const MAX_FREE_TEXT = 1000;

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  // Parse + validate body defensively.
  let body: { nps?: unknown; freeText?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  const nps = body.nps;
  if (typeof nps !== 'number' || !Number.isInteger(nps) || nps < 0 || nps > 10) {
    return resp(400, { error: 'nps must be an integer 0-10' });
  }

  let freeText: string | undefined;
  if (body.freeText !== undefined && body.freeText !== null) {
    if (typeof body.freeText !== 'string') {
      return resp(400, { error: 'freeText must be a string' });
    }
    if (body.freeText.length > MAX_FREE_TEXT) {
      return resp(400, { error: `freeText must be <= ${MAX_FREE_TEXT} characters` });
    }
    freeText = body.freeText;
  }

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    // Participation check — host is always allowed; otherwise look for a
    // PARTICIPANT# row. We intentionally keep this lightweight for MVP.
    let allowed = session.userId === userId;
    if (!allowed) {
      const participants = await getHangoutParticipants(tableName, sessionId);
      allowed = participants.some((p) => p.userId === userId);
    }
    if (!allowed) {
      return resp(403, { error: 'Only session participants can submit a survey' });
    }

    const written = await writeSurvey(tableName, {
      sessionId,
      userId,
      nps,
      freeText,
      sessionType: session.sessionType,
    });

    logger.info('Survey submitted', { sessionId, userId, nps });
    return resp(201, {
      sessionId: written.sessionId,
      userId: written.userId,
      nps: written.nps,
      freeText: written.freeText,
      submittedAt: written.submittedAt,
      sessionType: written.sessionType,
    });
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return resp(409, { error: 'A survey has already been submitted for this session' });
    }
    logger.error('Error submitting survey', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err instanceof Error ? err.message : String(err) });
  }
}
