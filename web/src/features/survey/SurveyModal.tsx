/**
 * SurveyModal — post-call NPS prompt shown once per (session, user).
 *
 * Flow:
 *   1. On mount we issue `GET /sessions/{id}/survey/mine`. A 200 means the
 *      user already submitted and the modal never renders.
 *   2. If 404, we show the prompt — 0-10 NPS buttons + optional free text.
 *   3. On submit, we POST `/sessions/{id}/survey`. A 201 closes the modal
 *      and calls `onSubmitted`. A 409 (already submitted) also closes
 *      silently. Other errors surface via `setError`.
 *
 * The caller owns when to mount this component (typically on the session-end
 * screen) — this component only decides whether to render based on the
 * existing-submission probe.
 */

import { useCallback, useEffect, useState } from 'react';

const MAX_FREE_TEXT = 1000;

interface SurveyModalProps {
  sessionId: string;
  authToken: string;
  apiBaseUrl: string;
  /** Called when the survey is successfully submitted (201). Optional. */
  onSubmitted?: () => void;
  /** Called when the user dismisses the prompt. Optional. */
  onSkipped?: () => void;
}

export function SurveyModal({
  sessionId,
  authToken,
  apiBaseUrl,
  onSubmitted,
  onSkipped,
}: SurveyModalProps) {
  const [shouldRender, setShouldRender] = useState<boolean>(false);
  const [probeDone, setProbeDone] = useState<boolean>(false);
  const [nps, setNps] = useState<number | null>(null);
  const [freeText, setFreeText] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Probe: has this user already submitted for this session?
  useEffect(() => {
    if (!sessionId || !authToken || !apiBaseUrl) return;
    let cancelled = false;
    fetch(`${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/survey/mine`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 404) {
          // Never submitted — show the modal.
          setShouldRender(true);
        }
        // Any other response (200 = already submitted, 500 = backend error,
        // etc.) keeps the modal hidden so we don't re-prompt or annoy users.
        setProbeDone(true);
      })
      .catch(() => {
        if (!cancelled) setProbeDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, authToken, apiBaseUrl]);

  const handleSubmit = useCallback(async () => {
    if (nps === null) {
      setError('Please pick a score from 0 to 10.');
      return;
    }
    if (freeText.length > MAX_FREE_TEXT) {
      setError(`Comment must be ${MAX_FREE_TEXT} characters or fewer.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/sessions/${encodeURIComponent(sessionId)}/survey`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            nps,
            freeText: freeText.trim() || undefined,
          }),
        },
      );
      if (res.status === 201 || res.status === 409) {
        // 409 means someone else already recorded a submission from this user
        // for this session — treat as success so the modal closes cleanly.
        setShouldRender(false);
        onSubmitted?.();
        return;
      }
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      setError(data?.error ?? `HTTP ${res.status}`);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  }, [apiBaseUrl, authToken, freeText, nps, onSubmitted, sessionId]);

  const handleSkip = useCallback(() => {
    setShouldRender(false);
    onSkipped?.();
  }, [onSkipped]);

  if (!probeDone || !shouldRender) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Thanks for joining!
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          How likely are you to recommend this session to a friend?
        </p>

        <div
          role="radiogroup"
          aria-label="NPS score from 0 to 10"
          className="grid grid-cols-11 gap-1.5 mb-1"
        >
          {Array.from({ length: 11 }, (_, i) => i).map((n) => {
            const selected = nps === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setNps(n)}
                className={`h-10 rounded-md text-sm font-semibold transition-colors cursor-pointer border ${
                  selected
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between text-[11px] text-gray-400 mb-4 px-0.5">
          <span>Not likely</span>
          <span>Very likely</span>
        </div>

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          Anything else? <span className="text-gray-400">(optional)</span>
        </label>
        <textarea
          value={freeText}
          onChange={(e) => setFreeText(e.target.value.slice(0, MAX_FREE_TEXT))}
          rows={3}
          maxLength={MAX_FREE_TEXT}
          placeholder="Tell us what worked or what we can improve..."
          className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex justify-between text-[11px] text-gray-400 mt-1">
          <span>{freeText.length}/{MAX_FREE_TEXT}</span>
        </div>

        {error && (
          <div className="mt-3 px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400 text-xs">
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleSkip}
            disabled={submitting}
            className="px-4 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors cursor-pointer"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || nps === null}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
