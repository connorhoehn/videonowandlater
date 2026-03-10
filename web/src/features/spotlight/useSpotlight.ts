/**
 * useSpotlight - Custom hook managing spotlight state and API interactions
 * for the Creator Spotlight feature.
 */

import React from 'react';
import { getConfig } from '../../config/aws-config';

export interface FeaturedCreator {
  sessionId: string;
  name: string;
}

export interface LiveSession {
  sessionId: string;
  userId: string;
  createdAt: string;
}

export interface UseSpotlightProps {
  sessionId: string;
  authToken: string;
  isLive: boolean;
}

export interface UseSpotlightReturn {
  featuredCreator: FeaturedCreator | null;
  liveSessions: LiveSession[];
  isLoadingLive: boolean;
  isModalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  selectCreator: (featuredSessionId: string, name: string) => Promise<void>;
  removeCreator: () => Promise<void>;
  refreshLiveSessions: () => Promise<void>;
}

export function useSpotlight({
  sessionId,
  authToken,
  isLive,
}: UseSpotlightProps): UseSpotlightReturn {
  const [featuredCreator, setFeaturedCreator] = React.useState<FeaturedCreator | null>(null);
  const [liveSessions, setLiveSessions] = React.useState<LiveSession[]>([]);
  const [isLoadingLive, setIsLoadingLive] = React.useState(false);
  const [isModalOpen, setIsModalOpen] = React.useState(false);

  const config = getConfig();
  const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

  // Poll session data every 10s when live to pick up featuredCreator changes
  React.useEffect(() => {
    if (!authToken || !isLive || !sessionId) return;

    const fetchSessionSpotlight = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.featuredCreatorId && data.featuredCreatorName) {
            setFeaturedCreator({
              sessionId: data.featuredCreatorId,
              name: data.featuredCreatorName,
            });
          } else {
            setFeaturedCreator(null);
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    // Initial fetch
    fetchSessionSpotlight();

    const interval = setInterval(fetchSessionSpotlight, 10000);
    return () => clearInterval(interval);
  }, [authToken, sessionId, isLive, apiBaseUrl]);

  const fetchLiveSessions = React.useCallback(async () => {
    if (!authToken) return;

    setIsLoadingLive(true);
    try {
      const response = await fetch(`${apiBaseUrl}/sessions/live`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        const data = await response.json();
        // Filter out own session from the list
        const sessions: LiveSession[] = (data.sessions || []).filter(
          (s: LiveSession) => s.sessionId !== sessionId
        );
        setLiveSessions(sessions);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setIsLoadingLive(false);
    }
  }, [authToken, apiBaseUrl, sessionId]);

  const openModal = React.useCallback(() => {
    setIsModalOpen(true);
    fetchLiveSessions();
  }, [fetchLiveSessions]);

  const closeModal = React.useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const selectCreator = React.useCallback(
    async (featuredSessionId: string, name: string) => {
      if (!authToken) return;

      // Optimistic update
      setFeaturedCreator({ sessionId: featuredSessionId, name });

      try {
        await fetch(`${apiBaseUrl}/sessions/${sessionId}/spotlight`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            featuredCreatorId: featuredSessionId,
            featuredCreatorName: name,
          }),
        });
      } catch {
        // Revert on error
        setFeaturedCreator(null);
      }
    },
    [authToken, apiBaseUrl, sessionId]
  );

  const removeCreator = React.useCallback(async () => {
    if (!authToken) return;

    // Optimistic update
    setFeaturedCreator(null);

    try {
      await fetch(`${apiBaseUrl}/sessions/${sessionId}/spotlight`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          featuredCreatorId: null,
          featuredCreatorName: null,
        }),
      });
    } catch {
      // ignore removal errors — local state already cleared
    }
  }, [authToken, apiBaseUrl, sessionId]);

  const refreshLiveSessions = React.useCallback(async () => {
    await fetchLiveSessions();
  }, [fetchLiveSessions]);

  return {
    featuredCreator,
    liveSessions,
    isLoadingLive,
    isModalOpen,
    openModal,
    closeModal,
    selectCreator,
    removeCreator,
    refreshLiveSessions,
  };
}
