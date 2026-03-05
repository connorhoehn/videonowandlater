/**
 * useViewerCount - polls the viewer count endpoint while a broadcast is live
 * Polls every 15 seconds; resets to 0 when not live.
 */

import { useState, useEffect, useRef } from 'react';

interface UseViewerCountOptions {
  sessionId: string;
  apiBaseUrl: string;
  isLive: boolean;
  pollIntervalMs?: number;
}

export function useViewerCount({
  sessionId,
  apiBaseUrl,
  isLive,
  pollIntervalMs = 15_000,
}: UseViewerCountOptions) {
  const [viewerCount, setViewerCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCount = async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/viewers`);
      if (!response.ok) return;
      const data = await response.json();
      setViewerCount(data.viewerCount ?? 0);
    } catch {
      // Silently ignore network errors — don't break the broadcast UI
    }
  };

  useEffect(() => {
    if (!isLive) {
      setViewerCount(0);
      return;
    }

    // Fetch immediately, then poll
    fetchCount();
    intervalRef.current = setInterval(fetchCount, pollIntervalMs);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isLive, sessionId, apiBaseUrl, pollIntervalMs]);

  return { viewerCount };
}
