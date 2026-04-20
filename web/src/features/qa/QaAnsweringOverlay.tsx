/**
 * QaAnsweringOverlay — viewer-side highlight card.
 *
 * Renders when a question is currently status='answering'. Shows the question
 * text + who asked it. The user can dismiss it locally (it will reappear if
 * the creator broadcasts another 'answering' status change for a different
 * question; if they mark this one 'answered' it disappears for everyone).
 */

import React, { useEffect, useState } from 'react';
import type { Question } from './types';

interface QaAnsweringOverlayProps {
  question: Question | null;
  className?: string;
}

export const QaAnsweringOverlay: React.FC<QaAnsweringOverlayProps> = ({ question, className }) => {
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // When the active question changes, reset the local dismiss so the new
  // question renders.
  useEffect(() => {
    if (question && dismissedId && question.questionId !== dismissedId) {
      setDismissedId(null);
    }
  }, [question, dismissedId]);

  if (!question) return null;
  if (dismissedId === question.questionId) return null;

  return (
    <div
      className={`pointer-events-auto bg-white/95 backdrop-blur-sm border border-blue-200 shadow-lg rounded-lg px-4 py-3 max-w-md ${className ?? ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-blue-700 font-semibold mb-1">
            Answering
          </p>
          <p className="text-sm text-gray-900 break-words">{question.text}</p>
          <p className="text-[11px] text-gray-500 mt-1.5">asked by {question.askedBy}</p>
        </div>
        <button
          onClick={() => setDismissedId(question.questionId)}
          aria-label="Dismiss"
          className="text-gray-400 hover:text-gray-600 text-xs -mr-1 -mt-1 p-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default QaAnsweringOverlay;
