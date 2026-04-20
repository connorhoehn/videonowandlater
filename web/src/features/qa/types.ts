/**
 * Live Q&A types — mirrors backend/src/domain/question.ts.
 */

export type QuestionStatus = 'pending' | 'answering' | 'answered';

export interface Question {
  questionId: string;
  sessionId: string;
  askedBy: string;
  text: string;
  status: QuestionStatus;
  createdAt: string;
  answeredAt?: string;
}

export const QUESTION_MAX_LENGTH = 280;
