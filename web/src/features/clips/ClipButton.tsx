/**
 * ClipButton — the "clip that moment" button.
 *
 * Shows:
 *   - Default: scissors icon, tappable.
 *   - Posting:  spinner (disabled) while the POST is in-flight.
 *   - Pending:  spinner + "Clipping..." label; shown while we've successfully
 *               created a clip but its status is still 'pending'.
 *   - Ready:    inline "Clip ready — view" link that, when clicked, opens
 *               the mp4 in a new tab.
 *
 * Also enforces a client-side rate-limit: one clip per 30s. Server may add
 * its own rate-limit later; this is just a UX guardrail.
 *
 * Expects the caller (BroadcastPage / ViewerPage) to supply the sessionId
 * and the Cognito bearer token.
 */

import { useCallback, useEffect, useState } from 'react';
import { createLiveClip } from './liveClipApi';
import { useLiveClips } from './useLiveClips';

const RATE_LIMIT_MS = 30_000;

export interface ClipButtonProps {
  sessionId: string;
  authToken: string | null;
  /** Optional className to position the button (e.g. "absolute bottom-4 right-4"). */
  className?: string;
}

export function ClipButton({ sessionId, authToken, className }: ClipButtonProps) {
  const [posting, setPosting] = useState(false);
  const [lastClickedAt, setLastClickedAt] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { pendingClip, recentClips } = useLiveClips(sessionId, authToken);

  // Most recent ready clip for this session (if any). Used to show the
  // "Clip ready — view" affordance after the user just clipped.
  const latestReady = recentClips.find((c) => c.status === 'ready');

  const disabled = !authToken || posting || !!pendingClip;

  // Clear transient messages after 3 seconds.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!errorMsg) return;
    const id = window.setTimeout(() => setErrorMsg(null), 4000);
    return () => window.clearTimeout(id);
  }, [errorMsg]);

  const handleClick = useCallback(async () => {
    if (!authToken) {
      setErrorMsg('Sign in to clip moments');
      return;
    }
    const now = Date.now();
    if (now - lastClickedAt < RATE_LIMIT_MS) {
      const seconds = Math.ceil((RATE_LIMIT_MS - (now - lastClickedAt)) / 1000);
      setErrorMsg(`Wait ${seconds}s before clipping again`);
      return;
    }

    setPosting(true);
    setErrorMsg(null);
    try {
      await createLiveClip(sessionId, authToken);
      setLastClickedAt(now);
      setToast('Clipping...');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clip';
      setErrorMsg(message);
    } finally {
      setPosting(false);
    }
  }, [authToken, lastClickedAt, sessionId]);

  // Compose the label shown beside/under the button. Priority: error > pending
  // > posting > ready > idle.
  const label: { text: string; tone: 'error' | 'info' | 'success' | 'muted' } | null =
    errorMsg
      ? { text: errorMsg, tone: 'error' }
      : pendingClip
        ? { text: 'Clipping...', tone: 'info' }
        : posting
          ? { text: 'Submitting...', tone: 'info' }
          : toast
            ? { text: toast, tone: 'info' }
            : latestReady?.mp4Url
              ? { text: 'Clip ready', tone: 'success' }
              : null;

  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label="Clip the last 10 seconds"
        className={[
          'inline-flex items-center justify-center rounded-full w-12 h-12',
          'bg-white/90 hover:bg-white text-gray-900 shadow-lg',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition focus:outline-none focus:ring-2 focus:ring-blue-500',
        ].join(' ')}
      >
        {posting || pendingClip ? (
          <Spinner />
        ) : (
          <ScissorsIcon />
        )}
      </button>

      {label && (
        <div
          className={[
            'text-xs font-medium rounded px-2 py-1 bg-black/60 text-white backdrop-blur-sm',
            label.tone === 'error' ? 'text-red-200' : '',
            label.tone === 'success' ? 'text-green-200' : '',
          ].join(' ')}
          role="status"
        >
          {label.text}
          {label.tone === 'success' && latestReady?.mp4Url && (
            <>
              {' '}
              &mdash;{' '}
              <a
                href={latestReady.mp4Url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                view
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScissorsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}
