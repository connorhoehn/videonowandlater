/**
 * useReactionListener - IVS Chat event listener for live reactions
 * Listens for 'reaction' events from IVS Chat room
 */

import { useEffect } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';
import type { EmojiType } from './ReactionPicker';

interface ReactionEvent {
  emojiType: EmojiType;
  userId: string;
  sessionRelativeTime: number;
}

export function useReactionListener(
  room: ChatRoom | undefined,
  onReaction: (reaction: ReactionEvent) => void
) {
  useEffect(() => {
    if (!room) return;

    const handleEvent = (event: any) => {
      if (event.eventName === 'reaction' && event.attributes) {
        const { emojiType, userId, timestamp } = event.attributes;
        if (emojiType && userId && timestamp) {
          onReaction({
            emojiType: emojiType as EmojiType,
            userId,
            sessionRelativeTime: parseInt(timestamp, 10),
          });
        }
      }
    };

    // Add listener for IVS Chat custom events
    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room, onReaction]);
}
