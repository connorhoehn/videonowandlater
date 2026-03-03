/**
 * useReactionSender - hook for sending reactions via POST API
 * Supports both live and replay reactions
 */

import { useCallback, useState } from 'react';
import type { EmojiType } from './ReactionPicker';

const API_BASE_URL = (window as any).APP_CONFIG?.apiBaseUrl || '';

interface SendReactionResponse {
  reactionId: string;
  eventId?: string;
  sessionRelativeTime: number;
}

export function useReactionSender(sessionId: string, authToken: string) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendReaction = useCallback(
    async (emojiType: EmojiType): Promise<SendReactionResponse | undefined> => {
      setSending(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/reactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ emojiType }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to send reaction');
        }

        return await response.json();
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        console.error('Failed to send reaction:', err);
        return undefined;
      } finally {
        setSending(false);
      }
    },
    [sessionId, authToken]
  );

  return { sendReaction, sending, error };
}
