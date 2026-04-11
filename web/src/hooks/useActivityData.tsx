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

function hasNonTerminalSessions(sessions: ActivitySession[]): boolean {
  return sessions.some(
    (s) =>
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
    } catch (err) {
      console.error('Error fetching activity:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  // Polling for non-terminal sessions
  useEffect(() => {
    const nonTerminal = hasNonTerminalSessions(sessions);

    // Reset poll interval when transitioning from all-terminal to having non-terminal sessions
    if (nonTerminal && !prevHasNonTerminalRef.current) {
      setPollInterval(15000);
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
      setPollInterval((prev) => Math.min(prev * 2, 60000));
    }, pollInterval);

    pollIntervalRef.current = intervalId;

    return () => {
      clearInterval(intervalId);
      pollIntervalRef.current = null;
    };
  }, [sessions, pollInterval]);

  return (
    <ActivityContext.Provider value={{ sessions, loading, refresh: fetchActivity }}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivityData(): ActivityContextValue {
  return useContext(ActivityContext);
}
