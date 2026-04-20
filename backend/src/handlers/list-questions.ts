/**
 * GET /sessions/{sessionId}/questions
 *
 * Returns all Q&A entries for a session to any authed caller.
 * (The creator panel uses this on mount + on chat events; viewers use it to
 * reconcile when the overlay mounts mid-broadcast.)
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { resp, requireUserId, mapKnownError } from '../lib/http';
import { getSessionById } from '../repositories/session-repository';
import { listQuestionsBySession } from '../repositories/question-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'list-questions' } });

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  try {
    requireUserId(event);
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    const questions = await listQuestionsBySession(tableName, sessionId);
    return resp(200, { questions });
  } catch (error) {
    logger.error('Error listing questions', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return resp(500, { error: 'Failed to list questions' });
  }
};
