/**
 * useAiAgentListener - IVS Chat event listener for AI agent status updates
 * Listens for ai_joining, ai_speaking, ai_done_speaking, ai_completed, ai_error events
 */

import { useEffect } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';

interface AiAgentCallbacks {
  onJoining: () => void;
  onSpeaking: (meta: { stepName: string; prompt: string; stepIndex: number; totalSteps: number }) => void;
  onDoneSpeaking: () => void;
  onCompleted: (meta: { slots: Record<string, string> }) => void;
  onError: (error: string) => void;
}

export function useAiAgentListener(
  room: ChatRoom | undefined,
  callbacks: AiAgentCallbacks,
) {
  useEffect(() => {
    if (!room) return;

    const handleEvent = (event: any) => {
      try {
        const meta = event.attributes?.meta ? JSON.parse(event.attributes.meta) : {};
        switch (event.eventName) {
          case 'ai_joining': callbacks.onJoining(); break;
          case 'ai_speaking': callbacks.onSpeaking(meta); break;
          case 'ai_done_speaking': callbacks.onDoneSpeaking(); break;
          case 'ai_completed': callbacks.onCompleted(meta); break;
          case 'ai_error': callbacks.onError(event.attributes?.error || 'Unknown error'); break;
        }
      } catch {
        // Ignore malformed events
      }
    };

    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room, callbacks]);
}
