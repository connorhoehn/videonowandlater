/**
 * Question repository - Q&A persistence operations.
 *
 * Single-table layout:
 *   PK: QA#<sessionId>
 *   SK: <createdAt>#<questionId>
 *
 * SK prefixing by createdAt (ISO 8601) gives natural chronological ordering
 * on Query (ScanIndexForward=true returns oldest first — matches the "queue"
 * semantics of a Q&A panel).
 */

import { PutCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { Question, QuestionStatus } from '../domain/question';

const logger = new Logger({ serviceName: 'vnl-repository' });

/**
 * Persist a new question to the table.
 */
export async function persistQuestion(tableName: string, question: Question): Promise<void> {
  const docClient = getDocumentClient();

  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `QA#${question.sessionId}`,
          SK: `${question.createdAt}#${question.questionId}`,
          entityType: 'QUESTION',
          ...question,
        },
      })
    );
  } catch (error) {
    logger.error('Error persisting question', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * List all questions for a session in chronological (oldest-first) order.
 */
export async function listQuestionsBySession(tableName: string, sessionId: string): Promise<Question[]> {
  const docClient = getDocumentClient();

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `QA#${sessionId}`,
        },
        ScanIndexForward: true, // oldest-first
      })
    );

    if (!result.Items || result.Items.length === 0) return [];

    return result.Items.map((item) => {
      const { PK, SK, entityType, ...question } = item;
      return question as Question;
    });
  } catch (error) {
    logger.error('Error listing questions', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Fetch a single question by sessionId + questionId.
 *
 * The SK embeds createdAt which we do not have at lookup time, so this uses a
 * Query with a FilterExpression. Fine for the volume of Q&A per session.
 */
export async function getQuestionById(
  tableName: string,
  sessionId: string,
  questionId: string
): Promise<Question | null> {
  const docClient = getDocumentClient();

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        FilterExpression: '#questionId = :qid',
        ExpressionAttributeNames: {
          '#questionId': 'questionId',
        },
        ExpressionAttributeValues: {
          ':pk': `QA#${sessionId}`,
          ':qid': questionId,
        },
      })
    );

    if (!result.Items || result.Items.length === 0) return null;

    const { PK, SK, entityType, ...question } = result.Items[0];
    return question as Question;
  } catch (error) {
    logger.error('Error getting question', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Update the status on a question.
 * Sets answeredAt when transitioning to 'answered'.
 *
 * Returns the updated Question.
 */
export async function updateQuestionStatus(
  tableName: string,
  question: Question,
  newStatus: QuestionStatus
): Promise<Question> {
  const docClient = getDocumentClient();

  const updates: string[] = ['#status = :status'];
  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, unknown> = { ':status': newStatus };

  let answeredAt: string | undefined = question.answeredAt;
  if (newStatus === 'answered' && !question.answeredAt) {
    answeredAt = new Date().toISOString();
    updates.push('#answeredAt = :answeredAt');
    names['#answeredAt'] = 'answeredAt';
    values[':answeredAt'] = answeredAt;
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: `QA#${question.sessionId}`,
          SK: `${question.createdAt}#${question.questionId}`,
        },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      })
    );
  } catch (error) {
    logger.error('Error updating question status', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }

  return {
    ...question,
    status: newStatus,
    ...(answeredAt ? { answeredAt } : {}),
  };
}

// Re-exported for symmetry with other repositories that hand-roll a Get.
export { GetCommand };
