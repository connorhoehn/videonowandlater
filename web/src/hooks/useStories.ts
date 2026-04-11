import { useState, useEffect, useCallback } from 'react';
import { getConfig } from '../config/aws-config';
import { fetchToken } from '../auth/fetchToken';

interface StorySegment {
  segmentId: string;
  type: 'image' | 'video';
  url: string;
  duration?: number;
  order: number;
}

interface StorySession {
  sessionId: string;
  userId: string;
  segments: StorySegment[];
  createdAt: string;
  storyExpiresAt: string;
  storyViewCount: number;
}

interface StoryUserGroup {
  userId: string;
  stories: StorySession[];
  hasUnseenStories: boolean;
}

interface UseStoriesReturn {
  storyUsers: StoryUserGroup[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markViewed: (sessionId: string) => Promise<void>;
  reactToStory: (sessionId: string, segmentId: string, emoji: string) => Promise<void>;
  replyToStory: (sessionId: string, segmentId: string, message: string) => Promise<void>;
}

export function useStories(): UseStoriesReturn {
  const [storyUsers, setStoryUsers] = useState<StoryUserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStories = useCallback(async () => {
    const config = getConfig();
    if (!config?.apiUrl) { setLoading(false); return; }
    try {
      const { token } = await fetchToken();
      const response = await fetch(`${config.apiUrl}/stories`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json();
      setStoryUsers(data.storyUsers || []);
      setError(null);
    } catch (err: any) {
      console.error('Error fetching stories:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStories(); }, [fetchStories]);

  const markViewed = useCallback(async (sessionId: string) => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    try {
      const { token } = await fetchToken();
      await fetch(`${config.apiUrl}/stories/${sessionId}/view`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      // Optimistic update: mark as seen locally
      setStoryUsers(prev => prev.map(group => {
        // Check if ALL stories in this group have been viewed
        const allViewed = group.stories.every(s => s.sessionId === sessionId);
        return {
          ...group,
          hasUnseenStories: allViewed ? false : group.hasUnseenStories,
        };
      }));
    } catch (err) {
      console.error('Error marking story viewed:', err);
    }
  }, []);

  const reactToStory = useCallback(async (sessionId: string, segmentId: string, emoji: string) => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    try {
      const { token } = await fetchToken();
      await fetch(`${config.apiUrl}/stories/${sessionId}/react`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId, emoji }),
      });
    } catch (err) {
      console.error('Error reacting to story:', err);
    }
  }, []);

  const replyToStory = useCallback(async (sessionId: string, segmentId: string, message: string) => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    try {
      const { token } = await fetchToken();
      await fetch(`${config.apiUrl}/stories/${sessionId}/reply`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId, message }),
      });
    } catch (err) {
      console.error('Error replying to story:', err);
    }
  }, []);

  return { storyUsers, loading, error, refresh: fetchStories, markViewed, reactToStory, replyToStory };
}
