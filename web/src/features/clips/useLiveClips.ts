/**
 * useLiveClips — poll GET /me/clips while there's a pending clip for the
 * given session, surface { pendingClip, recentClips }.
 *
 * Polling strategy: every 5s whenever at least one pending live-clip for this
 * session is outstanding. When nothing is pending, we stop polling (we re-
 * fetch once immediately on mount so the panel is populated).
 *
 * Scope: this hook is intentionally scoped to a single sessionId — it's
 * meant for the broadcast / viewer pages where we care about "is the clip
 * I just took ready yet?". MyClipsPanel uses `listMyClips` directly for a
 * one-shot fetch across all sessions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listMyClips } from './liveClipApi';
import { isLiveClip, type Clip, type LiveClip } from './types';

const POLL_INTERVAL_MS = 5_000;

export interface UseLiveClipsResult {
  /** Oldest still-pending live clip for this session (undefined if none). */
  pendingClip: LiveClip | undefined;
  /** All live-clips for this session (any status), newest first. */
  recentClips: LiveClip[];
  /** All clips returned by the API (both live + post-session), newest first. */
  allClips: Clip[];
  /** Manually refetch immediately. */
  refresh: () => Promise<void>;
  /** True while the initial fetch is in-flight. */
  loading: boolean;
  error: string | null;
}

export function useLiveClips(sessionId: string, authToken: string | null): UseLiveClipsResult {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (!authToken) return;
    try {
      const next = await listMyClips(authToken);
      if (cancelledRef.current) return;
      setClips(next);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load clips');
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [authToken]);

  // Initial load.
  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    fetchOnce();
    return () => {
      cancelledRef.current = true;
    };
  }, [fetchOnce]);

  const sessionLiveClips = useMemo<LiveClip[]>(
    () =>
      clips
        .filter((c): c is LiveClip => isLiveClip(c) && c.sessionId === sessionId),
    [clips, sessionId],
  );

  const pendingClip = useMemo<LiveClip | undefined>(() => {
    // Use the oldest pending clip (trailing end of the list since clips are
    // sorted newest-first) so the UI surfaces the clip the user has been
    // waiting on the longest.
    const pending = sessionLiveClips.filter((c) => c.status === 'pending');
    return pending[pending.length - 1];
  }, [sessionLiveClips]);

  // Polling loop while something is pending for this session.
  useEffect(() => {
    if (!pendingClip || !authToken) return;
    const id = window.setInterval(() => {
      fetchOnce();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [pendingClip, authToken, fetchOnce]);

  return {
    pendingClip,
    recentClips: sessionLiveClips,
    allClips: clips,
    refresh: fetchOnce,
    loading,
    error,
  };
}
