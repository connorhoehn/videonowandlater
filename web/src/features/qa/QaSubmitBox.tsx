/**
 * QaSubmitBox — viewer-side input for submitting a question to the creator.
 *
 * Client-side rate limit: max 1 submission per 20s. Uses a ref + timestamp so
 * a component re-mount doesn't accidentally reset it mid-session (the timestamp
 * is kept in a ref scoped to the component lifetime).
 *
 * Max 280 characters, matches backend validation.
 */

import React, { useRef, useState } from 'react';
import { submitQuestion } from './qaApi';
import { QUESTION_MAX_LENGTH } from './types';

interface QaSubmitBoxProps {
  sessionId: string;
  authToken: string;
  className?: string;
  /** Optional callback fired on successful submit (for toast/UX outside the component). */
  onSubmitted?: () => void;
}

const RATE_LIMIT_MS = 20_000;

export const QaSubmitBox: React.FC<QaSubmitBoxProps> = ({
  sessionId,
  authToken,
  className,
  onSubmitted,
}) => {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const lastSubmitRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);

  const startCooldown = () => {
    const tick = () => {
      const remain = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastSubmitRef.current));
      setCooldownRemaining(remain);
      if (remain > 0) {
        tickRef.current = window.setTimeout(tick, 500);
      } else {
        tickRef.current = null;
      }
    };
    tick();
  };

  // Cleanup timer on unmount
  React.useEffect(() => {
    return () => {
      if (tickRef.current !== null) window.clearTimeout(tickRef.current);
    };
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > QUESTION_MAX_LENGTH) {
      setError(`Max ${QUESTION_MAX_LENGTH} characters`);
      return;
    }

    const sinceLast = Date.now() - lastSubmitRef.current;
    if (sinceLast < RATE_LIMIT_MS) {
      const wait = Math.ceil((RATE_LIMIT_MS - sinceLast) / 1000);
      setError(`Please wait ${wait}s before submitting another question`);
      return;
    }

    setSubmitting(true);
    try {
      await submitQuestion(sessionId, authToken, trimmed);
      setText('');
      lastSubmitRef.current = Date.now();
      startCooldown();
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit question');
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || cooldownRemaining > 0;
  const chars = text.length;
  const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);

  return (
    <form
      onSubmit={handleSubmit}
      className={`bg-white/90 backdrop-blur-sm border border-gray-200 rounded-full px-3 py-2 flex items-center gap-2 ${className ?? ''}`}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={QUESTION_MAX_LENGTH}
        disabled={submitting}
        placeholder={cooldownRemaining > 0 ? `Wait ${cooldownSeconds}s…` : 'Ask a question…'}
        className="flex-1 bg-transparent text-sm placeholder-gray-400 focus:outline-none disabled:text-gray-400"
        aria-label="Ask a question"
      />
      <span className={`text-[10px] ${chars > QUESTION_MAX_LENGTH - 20 ? 'text-amber-600' : 'text-gray-400'}`}>
        {chars}/{QUESTION_MAX_LENGTH}
      </span>
      <button
        type="submit"
        disabled={disabled || text.trim().length === 0}
        className="text-xs font-medium px-3 py-1 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? 'Sending…' : 'Ask'}
      </button>
      {error && (
        <div className="absolute -top-8 left-0 right-0 text-center text-[11px] text-red-600 bg-white/90 rounded px-2 py-1 shadow-sm pointer-events-none">
          {error}
        </div>
      )}
    </form>
  );
};

export default QaSubmitBox;
