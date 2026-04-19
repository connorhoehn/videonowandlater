/**
 * TrainingOverlay — shows an unseen training module (from vnl-ads) inline
 * over the session view. One-shot: once the user completes playback OR skips
 * past the minimum watch time, we call /me/training-claim and unmount.
 *
 * Intentionally inline (not blocking). The MVP assumes 15s clips and the
 * creator keeps streaming behind it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';

interface TrainingItem {
  assignmentId: string;
  creativeId: string;
  title: string;
  thumbnailUrl: string | null;
  assetUrl: string;
  durationMs: number | null;
  assignedAt: string;
}

interface TrainingOverlayProps {
  sessionId?: string;
  /** Seconds the user must watch before the "Dismiss" button enables. Default 5. */
  minWatchSeconds?: number;
}

export function TrainingOverlay({ sessionId, minWatchSeconds = 5 }: TrainingOverlayProps) {
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [item, setItem] = useState<TrainingItem | null>(null);
  const [watched, setWatched] = useState(0);
  const [claimed, setClaimed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const claimingRef = useRef(false);

  // Fetch on mount — one-shot, not polled.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { token } = await fetchToken();
        const res = await fetch(`${apiBaseUrl}/me/training-due?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { items?: TrainingItem[] };
        if (cancelled) return;
        const first = data.items?.[0];
        if (first) setItem(first);
      } catch {
        /* feature flag off / network — silently skip */
      }
    })();
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  const claim = useCallback(async () => {
    if (!item || claimingRef.current || claimed) return;
    claimingRef.current = true;
    try {
      const { token } = await fetchToken();
      await fetch(`${apiBaseUrl}/me/training-claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ creativeId: item.creativeId, sessionId }),
      });
    } catch {
      /* non-fatal — user saw the video; claim is best-effort */
    } finally {
      setClaimed(true);
      setItem(null); // unmount
    }
  }, [apiBaseUrl, item, sessionId, claimed]);

  const canDismiss = useMemo(() => watched >= minWatchSeconds, [watched, minWatchSeconds]);

  // Tick watched seconds
  useEffect(() => {
    if (!item) return;
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setWatched(Math.floor(v.currentTime));
    const onEnded = () => void claim();
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnded);
    };
  }, [item, claim]);

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-label="Training module"
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl max-w-xl w-full overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-blue-600 dark:text-blue-400 font-semibold">
              Training
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {item.title}
            </h3>
          </div>
          <button
            onClick={() => void claim()}
            disabled={!canDismiss}
            className="text-xs px-3 py-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            {canDismiss ? 'Dismiss' : `Dismiss in ${Math.max(0, minWatchSeconds - watched)}s`}
          </button>
        </div>
        <video
          ref={videoRef}
          src={item.assetUrl}
          poster={item.thumbnailUrl ?? undefined}
          className="w-full bg-black"
          autoPlay
          playsInline
          controls
        />
      </div>
    </div>
  );
}
