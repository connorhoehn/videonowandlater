/**
 * POST /sessions/{sessionId}/questions/{questionId}/status
 *
 * Creator-only endpoint to mark a question as 'answering' (spotlight to viewers)
 * or 'answered' (dismiss). Broadcasts 'question-status-changed' on the session's
 * IVS chat room so viewer overlays + creator panels update live.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { resp, requireUserId, parseJsonBody, mapKnownError } from '../lib/http';
import { getSessionById } from '../repositories/session-repository';
import {
  getQuestionById,
  updateQuestionStatus as repoUpdateQuestionStatus,
} from '../repositories/question-repository';
import { broadcastQuestionStatusChanged } from '../services/qa-service';
import { QuestionStatus, type QuestionStatus as TQuestionStatus } from '../domain/question';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'update-question-status' } });

interface UpdateQuestionStatusRequest {
  status?: string;
}

const ALLOWED_STATUSES: TQuestionStatus[] = [QuestionStatus.ANSWERING, QuestionStatus.ANSWERED];

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  let actorId: string;
  try {
    actorId = requireUserId(event);
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }

  const sessionId = event.pathParameters?.sessionId;
  const questionId = event.pathParameters?.questionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });
  if (!questionId) return resp(400, { error: 'questionId required' });

  const parsed = parseJsonBody<UpdateQuestionStatusRequest>(event);
  if (!parsed.ok) return parsed.response;

  const status = parsed.data.status;
  if (!status || !ALLOWED_STATUSES.includes(status as TQuestionStatus)) {
    return resp(400, { error: "status must be 'answering' or 'answered'" });
  }

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    if (session.userId !== actorId) {
      return resp(403, { error: 'Only the session owner can update question status' });
    }

    const question = await getQuestionById(tableName, sessionId, questionId);
    if (!question) return resp(404, { error: 'Question not found' });

    const updated = await repoUpdateQuestionStatus(tableName, question, status as TQuestionStatus);

    try {
      if (session.claimedResources?.chatRoom) {
        await broadcastQuestionStatusChanged(session.claimedResources.chatRoom, updated);
      }
    } catch (err) {
      logger.warn('Broadcast of question-status-changed failed — continuing', {
        sessionId,
        questionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return resp(200, { question: updated });
  } catch (error) {
    logger.error('Error updating question status', {
      sessionId,
      questionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return resp(500, { error: 'Failed to update question status' });
  }
};
