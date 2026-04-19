/**
 * GET /sessions/{sessionId}/survey/mine
 *
 * Returns the caller's own survey submission for this session, or 404 when the
 * caller hasn't submitted yet. Used by the survey modal on mount so we don't
 * re-prompt users who already responded.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getSurveyForSession } from '../repositories/survey-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'get-my-survey' },
});

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

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  try {
    const survey = await getSurveyForSession(tableName, sessionId, userId);
    if (!survey) return resp(404, { error: 'No survey submitted' });
    return resp(200, {
      sessionId: survey.sessionId,
      userId: survey.userId,
      nps: survey.nps,
      freeText: survey.freeText,
      submittedAt: survey.submittedAt,
      sessionType: survey.sessionType,
    });
  } catch (err: any) {
    logger.error('Error fetching own survey', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err instanceof Error ? err.message : String(err) });
  }
}
