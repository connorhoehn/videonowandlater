import { useMemo } from 'react';
import type { ChatMessage } from '../../../../backend/src/domain/chat-message';

/**
 * Filters chat messages based on video playback position
 *
 * Uses sessionRelativeTime (milliseconds since stream start) to determine
 * which messages should be visible at the current playback position.
 *
 * @param allMessages - Full chat history for the session
 * @param currentSyncTime - Elapsed playback milliseconds from player.getPosition() * 1000
 * @returns Filtered array of messages that should be visible at current playback position
 */
export function useSynchronizedChat(
  allMessages: ChatMessage[],
  currentSyncTime: number
): ChatMessage[] {
  return useMemo(() => {
    if (currentSyncTime === 0) {
      return []; // No playback started yet
    }

    return allMessages.filter(
      msg => msg.sessionRelativeTime !== undefined &&
             msg.sessionRelativeTime <= currentSyncTime
    );
  }, [allMessages, currentSyncTime]);
}
