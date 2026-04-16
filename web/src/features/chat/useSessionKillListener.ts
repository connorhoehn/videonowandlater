/**
 * useSessionKillListener - IVS Chat event listener for admin kill notifications
 * Listens for 'session_killed' events from IVS Chat room
 */

import { useEffect } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';

export function useSessionKillListener(
  room: ChatRoom | undefined,
  onKill: (reason: string) => void
) {
  useEffect(() => {
    if (!room) return;

    const handleEvent = (event: any) => {
      if (event.eventName === 'session_killed') {
        onKill(event.attributes?.reason || 'This session has been ended by a moderator');
      }
    };

    // Add listener for IVS Chat custom events
    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room, onKill]);
}
