/**
 * Shared context for activity session data.
 * Fetches once and provides data to both the HomePage feed and sidebar widgets,
 * eliminating duplicate /activity API calls.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { getConfig } from '../config/aws-config';
import type { ActivitySession } from '../features/activity/RecordingSlider';

interface ActivityContextValue {
  sessions: ActivitySession[];
  loading: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  loadingMore: boolean;
}

const ActivityContext = createContext<ActivityContextValue>({
  sessions: [],
  loading: true,
  refresh: async () => {},
  loadMore: async () => {},
  hasMore: false,
  loadingMore: false,
});

function hasLiveSessions(sessions: ActivitySession[]): boolean {
  return sessions.some((s) => s.status === 'live');
}

function hasNonTerminalSessions(sessions: ActivitySession[]): boolean {
  return sessions.some(
    (s) =>
      s.status === 'live' ||
      s.transcriptStatus === 'processing' ||
      s.transcriptStatus === 'pending' ||
      s.aiSummaryStatus === 'pending' ||
      s.convertStatus === 'processing' ||
      s.convertStatus === 'pending',
  );
}

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState(15000);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevHasNonTerminalRef = useRef(false);

  const fetchActivity = useCallback(async () => {
    const config = getConfig();
    if (!config?.apiUrl) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${config.apiUrl}/activity`);
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json();
      setSessions(data.sessions || []);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      console.error('Error fetching activity:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const config = getConfig();
    if (!config?.apiUrl) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `${config.apiUrl}/activity?cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json();
      setSessions((prev) => [...prev, ...(data.sessions || [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (err) {
      console.error('Error loading more activity:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  // Initial fetch
  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Polling for non-terminal sessions
  useEffect(() => {
    const nonTerminal = hasNonTerminalSessions(sessions);

    const live = hasLiveSessions(sessions);

    // Reset poll interval when transitioning from all-terminal to having non-terminal sessions
    // Use 5s for live sessions, 15s for other non-terminal states
    if (nonTerminal && !prevHasNonTerminalRef.current) {
      setPollInterval(live ? 5000 : 15000);
    } else if (live) {
      setPollInterval(5000);
    }
    prevHasNonTerminalRef.current = nonTerminal;

    if (!nonTerminal) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const intervalId = setInterval(async () => {
      const config = getConfig();
      if (!config?.apiUrl) return;
      try {
        const response = await fetch(`${config.apiUrl}/activity`);
        if (!response.ok) throw new Error(`${response.status}`);
        const data = await response.json();
        setSessions(data.sessions || []);
      } catch (err) {
        console.error('Error polling activity:', err);
      }
      const live = hasLiveSessions(sessions);
      // Don't back off beyond 5s when live sessions exist
      if (!live) {
        setPollInterval((prev) => Math.min(prev * 2, 60000));
      }
    }, pollInterval);

    pollIntervalRef.current = intervalId;

    return () => {
      clearInterval(intervalId);
      pollIntervalRef.current = null;
    };
  }, [sessions, pollInterval]);

  return (
    <ActivityContext.Provider
      value={{
        sessions,
        loading,
        refresh: fetchActivity,
        loadMore,
        hasMore: nextCursor !== null,
        loadingMore,
      }}
    >
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivityData(): ActivityContextValue {
  return useContext(ActivityContext);
}
