/**
 * useUserKickListener — IVS Chat event listener for `user_kicked` events.
 *
 * Emitted by the backend when a user is bounced from a session (scope: 'session')
 * or hit with a global ban (scope: 'global'). If the kicked userId matches the
 * current user, we call `onSelfKicked` (typically redirect + message); otherwise
 * we call `onOtherKicked` (typically a toast).
 */

import { useEffect } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';

export interface UserKickedEvent {
  userId: string;
  reason: string;
  scope: 'session' | 'global';
}

interface UseUserKickListenerOpts {
  room: ChatRoom | undefined;
  currentUserId: string | undefined;
  onSelfKicked: (event: UserKickedEvent) => void;
  onOtherKicked?: (event: UserKickedEvent) => void;
}

export function useUserKickListener({
  room,
  currentUserId,
  onSelfKicked,
  onOtherKicked,
}: UseUserKickListenerOpts) {
  useEffect(() => {
    if (!room) return;

    const handleEvent = (event: any) => {
      if (event.eventName !== 'user_kicked') return;
      const attrs = event.attributes ?? {};
      const kicked: UserKickedEvent = {
        userId: String(attrs.userId ?? ''),
        reason: String(attrs.reason ?? 'Removed by moderator'),
        scope: attrs.scope === 'global' ? 'global' : 'session',
      };
      if (!kicked.userId) return;
      if (currentUserId && kicked.userId === currentUserId) {
        onSelfKicked(kicked);
      } else if (onOtherKicked) {
        onOtherKicked(kicked);
      }
    };

    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room, currentUserId, onSelfKicked, onOtherKicked]);
}
