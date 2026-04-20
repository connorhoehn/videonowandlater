/**
 * QaPanel — creator-side queue of submitted questions.
 *
 * Shows all questions with:
 *   - "Answer Now" button on pending/answered questions (promotes to 'answering')
 *   - "Mark Answered" button on pending/answering questions (moves to 'answered')
 * The currently-answering question (if any) is visually emphasized.
 *
 * Mirrors the structure of PollsPanel: uses useLiveQa for data + chat-room
 * listener, renders a header + scrollable list + inline action buttons.
 */

import React, { useState } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';
import { useLiveQa } from './useLiveQa';
import { updateQuestionStatus } from './qaApi';
import type { Question } from './types';

interface QaPanelProps {
  sessionId: string;
  authToken: string;
  room?: ChatRoom;
}

export const QaPanel: React.FC<QaPanelProps> = ({ sessionId, authToken, room }) => {
  const { questions, loading, error, refresh } = useLiveQa({ sessionId, authToken, room });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStatus = async (q: Question, status: 'answering' | 'answered') => {
    setPendingId(q.questionId);
    setActionError(null);
    try {
      await updateQuestionStatus(sessionId, q.questionId, authToken, status);
      // Event broadcast will refresh via useLiveQa's chat listener; fall back to
      // an explicit refetch if the chat room isn't connected.
      if (!room) await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white/95 backdrop-blur-sm">
      <div className="border-b border-gray-200 px-3 py-2.5 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Q&amp;A</h2>
        <span className="text-[10px] text-gray-500">{questions.length} question{questions.length === 1 ? '' : 's'}</span>
      </div>

      {error && (
        <div className="bg-red-50 border-b border-red-200 px-3 py-2 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => void refresh()}
            className="text-red-700 underline text-xs ml-2"
          >
            Retry
          </button>
        </div>
      )}
      {actionError && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 py-2 text-xs text-amber-800">
          {actionError}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && questions.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">Loading…</div>
        ) : questions.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 text-center">
            No questions yet. When viewers submit, they'll show up here.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {questions.map((q) => {
              const isAnswering = q.status === 'answering';
              const isAnswered = q.status === 'answered';
              const busy = pendingId === q.questionId;
              return (
                <li
                  key={q.questionId}
                  className={`px-3 py-2.5 ${
                    isAnswering
                      ? 'bg-blue-50 border-l-4 border-blue-500'
                      : isAnswered
                      ? 'bg-gray-50 opacity-60'
                      : 'bg-white'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm break-words ${isAnswered ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                        {q.text}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        from {q.askedBy}
                        {isAnswering && <span className="ml-2 text-blue-600 font-medium">• Answering now</span>}
                        {isAnswered && <span className="ml-2 text-gray-500">• Answered</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {!isAnswering && !isAnswered && (
                      <button
                        onClick={() => handleStatus(q, 'answering')}
                        disabled={busy}
                        className="text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Answer Now
                      </button>
                    )}
                    {isAnswering && (
                      <button
                        onClick={() => handleStatus(q, 'answered')}
                        disabled={busy}
                        className="text-xs px-2.5 py-1 rounded-md bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50"
                      >
                        Mark Answered
                      </button>
                    )}
                    {!isAnswering && !isAnswered && (
                      <button
                        onClick={() => handleStatus(q, 'answered')}
                        disabled={busy}
                        className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Mark Answered
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default QaPanel;
