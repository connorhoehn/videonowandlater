import { useState, useCallback } from 'react';

const STORAGE_KEY = 'vnl_story_views';

interface ViewState {
  [sessionId: string]: number; // timestamp of when viewed
}

export function useStoryViewState() {
  const [viewState, setViewState] = useState<ViewState>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const markViewed = useCallback((sessionId: string) => {
    setViewState(prev => {
      const next = { ...prev, [sessionId]: Date.now() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const hasViewed = useCallback((sessionId: string): boolean => {
    return !!viewState[sessionId];
  }, [viewState]);

  // Clean up views older than 48h (stories expire at 24h, buffer for safety)
  const cleanup = useCallback(() => {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    setViewState(prev => {
      const cleaned: ViewState = {};
      for (const [id, ts] of Object.entries(prev)) {
        if (ts > cutoff) cleaned[id] = ts;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      return cleaned;
    });
  }, []);

  return { markViewed, hasViewed, cleanup };
}
