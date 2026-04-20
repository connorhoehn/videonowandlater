/**
 * Q&A domain model
 * Defines live question structure for audience Q&A during broadcasts.
 */

/**
 * Lifecycle status for a live Q&A question.
 *   pending   — submitted, waiting for creator review
 *   answering — currently being answered (highlighted on viewer overlay)
 *   answered  — dismissed / finished
 */
export const QuestionStatus = {
  PENDING: 'pending',
  ANSWERING: 'answering',
  ANSWERED: 'answered',
} as const;
export type QuestionStatus = typeof QuestionStatus[keyof typeof QuestionStatus];

/**
 * Maximum length of a submitted question body (characters).
 */
export const QUESTION_MAX_LENGTH = 280;

/**
 * Question entity.
 * Persisted in the shared DDB table at PK: QA#<sessionId>, SK: <createdAt>#<questionId>
 */
export interface Question {
  questionId: string;
  sessionId: string;
  askedBy: string;
  text: string;
  status: QuestionStatus;
  createdAt: string;
  answeredAt?: string;
}

/**
 * Validate question text. Returns an error message if invalid, null if OK.
 */
export function validateQuestionText(text: unknown): string | null {
  if (typeof text !== 'string') return 'text required';
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'text required';
  if (trimmed.length > QUESTION_MAX_LENGTH) {
    return `text must be ${QUESTION_MAX_LENGTH} characters or fewer`;
  }
  return null;
}
