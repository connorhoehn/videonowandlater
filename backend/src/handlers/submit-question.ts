/**
 * POST /sessions/{sessionId}/questions
 *
 * Any authed viewer can submit a question (max 280 chars) against a session.
 * Persists the question in DDB and broadcasts a 'question-submitted' event on
 * the session's IVS chat room so the creator panel can update live.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { resp, requireUserId, parseJsonBody, mapKnownError } from '../lib/http';
import { getSessionById } from '../repositories/session-repository';
import { persistQuestion } from '../repositories/question-repository';
import { broadcastQuestionSubmitted } from '../services/qa-service';
import type { Question } from '../domain/question';
import { QuestionStatus, validateQuestionText } from '../domain/question';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'submit-question' } });

interface SubmitQuestionRequest {
  text?: string;
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  let userId: string;
  try {
    userId = requireUserId(event);
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  const parsed = parseJsonBody<SubmitQuestionRequest>(event);
  if (!parsed.ok) return parsed.response;

  const validationError = validateQuestionText(parsed.data.text);
  if (validationError) return resp(400, { error: validationError });

  const text = (parsed.data.text as string).trim();

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    const question: Question = {
      questionId: uuid(),
      sessionId,
      askedBy: userId,
      text,
      status: QuestionStatus.PENDING,
      createdAt: new Date().toISOString(),
    };

    await persistQuestion(tableName, question);

    // Broadcast — non-fatal if it fails; the creator can still fetch via GET.
    try {
      if (session.claimedResources?.chatRoom) {
        await broadcastQuestionSubmitted(session.claimedResources.chatRoom, question);
      }
    } catch (err) {
      logger.warn('Broadcast of question-submitted failed — continuing', {
        sessionId,
        questionId: question.questionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return resp(201, { question });
  } catch (error) {
    logger.error('Error submitting question', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return resp(500, { error: 'Failed to submit question' });
  }
};
