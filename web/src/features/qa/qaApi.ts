/**
 * Live Q&A API helpers — thin fetch wrappers around the /sessions/:id/questions routes.
 */

import { getConfig } from '../../config/aws-config';
import type { Question, QuestionStatus } from './types';

function apiBaseUrl(): string {
  return getConfig()?.apiUrl ?? '';
}

function authHeaders(authToken: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };
}

export interface SubmitQuestionResponse {
  question: Question;
}

export async function submitQuestion(
  sessionId: string,
  authToken: string,
  text: string
): Promise<Question> {
  const response = await fetch(`${apiBaseUrl()}/sessions/${sessionId}/questions`, {
    method: 'POST',
    headers: authHeaders(authToken),
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    let message = 'Failed to submit question';
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* ignore JSON parse errors */
    }
    throw new Error(message);
  }

  const data = (await response.json()) as SubmitQuestionResponse;
  return data.question;
}

export interface ListQuestionsResponse {
  questions: Question[];
}

export async function listQuestions(
  sessionId: string,
  authToken: string
): Promise<Question[]> {
  const response = await fetch(`${apiBaseUrl()}/sessions/${sessionId}/questions`, {
    method: 'GET',
    headers: authHeaders(authToken),
  });

  if (!response.ok) {
    throw new Error(`Failed to load questions (${response.status})`);
  }

  const data = (await response.json()) as ListQuestionsResponse;
  return data.questions ?? [];
}

export interface UpdateQuestionStatusResponse {
  question: Question;
}

export async function updateQuestionStatus(
  sessionId: string,
  questionId: string,
  authToken: string,
  status: Extract<QuestionStatus, 'answering' | 'answered'>
): Promise<Question> {
  const response = await fetch(
    `${apiBaseUrl()}/sessions/${sessionId}/questions/${questionId}/status`,
    {
      method: 'POST',
      headers: authHeaders(authToken),
      body: JSON.stringify({ status }),
    }
  );

  if (!response.ok) {
    let message = 'Failed to update question status';
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const data = (await response.json()) as UpdateQuestionStatusResponse;
  return data.question;
}
