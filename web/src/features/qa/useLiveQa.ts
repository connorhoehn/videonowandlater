/**
 * useLiveQa — hook that keeps a list of session Q&A entries in sync.
 *
 * - Does an initial GET on mount (+ when sessionId/authToken change).
 * - Subscribes to the IVS chat room for 'question-submitted' and
 *   'question-status-changed' events and patches local state incrementally.
 *
 * Returns:
 *   questions       — full list, oldest-first
 *   activeQuestion  — the question currently status='answering', or null
 *   refresh         — manual refetch (for retry-after-error UX)
 *   loading / error — initial fetch state
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';
import { listQuestions } from './qaApi';
import type { Question, QuestionStatus } from './types';

interface UseLiveQaOptions {
  sessionId: string;
  authToken: string;
  room?: ChatRoom;
}

interface UseLiveQaResult {
  questions: Question[];
  activeQuestion: Question | null;
  refresh: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * Parse an IVS chat event's attributes into a Question object.
 * Returns null if required fields are missing.
 */
function parseQuestionFromEvent(attrs: Record<string, string> | undefined): Question | null {
  if (!attrs) return null;
  const { questionId, sessionId, askedBy, text, status, createdAt, answeredAt } = attrs;
  if (!questionId || !sessionId || !askedBy || !text || !status || !createdAt) return null;
  if (status !== 'pending' && status !== 'answering' && status !== 'answered') return null;
  return {
    questionId,
    sessionId,
    askedBy,
    text,
    status: status as QuestionStatus,
    createdAt,
    ...(answeredAt ? { answeredAt } : {}),
  };
}

/**
 * Merge an incoming question into the list:
 *  - replace in place if it exists (by questionId)
 *  - otherwise append and re-sort by createdAt
 */
function mergeQuestion(list: Question[], incoming: Question): Question[] {
  const idx = list.findIndex((q) => q.questionId === incoming.questionId);
  if (idx >= 0) {
    const copy = list.slice();
    copy[idx] = incoming;
    return copy;
  }
  return [...list, incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function useLiveQa({ sessionId, authToken, room }: UseLiveQaOptions): UseLiveQaResult {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable refs so the chat event handler doesn't re-subscribe on every render.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const refresh = useCallback(async () => {
    if (!sessionId || !authToken) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listQuestions(sessionId, authToken);
      setQuestions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load questions');
    } finally {
      setLoading(false);
    }
  }, [sessionId, authToken]);

  // Initial load + reload when session/token change.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates via IVS chat custom events.
  useEffect(() => {
    if (!room) return;

    const handleEvent = (event: {
      eventName?: string;
      attributes?: Record<string, string>;
    }) => {
      if (event.eventName !== 'question-submitted' && event.eventName !== 'question-status-changed') {
        return;
      }
      // Guard against stray events from other sessions (defensive — chat rooms
      // are per-session, but a stale reconnect could in theory deliver late).
      if (event.attributes?.sessionId && event.attributes.sessionId !== sessionIdRef.current) {
        return;
      }
      const incoming = parseQuestionFromEvent(event.attributes);
      if (!incoming) return;
      setQuestions((prev) => mergeQuestion(prev, incoming));
    };

    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room]);

  const activeQuestion = useMemo(
    () => questions.find((q) => q.status === 'answering') ?? null,
    [questions]
  );

  return { questions, activeQuestion, refresh, loading, error };
}
