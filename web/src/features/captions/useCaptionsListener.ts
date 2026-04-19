/**
 * useCaptionsListener — subscribes to IVS Chat `caption` and `captions_toggled`
 * events and surfaces a normalized rolling caption state for the overlay.
 *
 * `caption` events carry the live segment text (interim or final) pushed by the
 * host from Transcribe Streaming. `captions_toggled` events notify viewers when
 * the host turns captions on/off at runtime so the UI can hide immediately.
 */

import { useEffect, useState } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';

export interface CaptionSegment {
  /** monotonic id so React can key the rolling list */
  id: number;
  text: string;
  startSec: number;
  endSec: number;
  isFinal: boolean;
  speakerLabel?: string;
  receivedAt: number;
}

export interface UseCaptionsListenerResult {
  /** Most-recent 2 rolling captions (Netflix-style) */
  captions: CaptionSegment[];
  /** Whether the host currently has captions enabled (driven by captions_toggled events) */
  hostCaptionsEnabled: boolean | null;
}

let nextId = 1;

export function useCaptionsListener(
  room: ChatRoom | undefined,
  initialEnabled: boolean | null = null
): UseCaptionsListenerResult {
  const [captions, setCaptions] = useState<CaptionSegment[]>([]);
  const [hostCaptionsEnabled, setHostCaptionsEnabled] = useState<boolean | null>(initialEnabled);

  useEffect(() => {
    if (!room) return;

    const handleEvent = (event: any) => {
      if (event.eventName === 'caption' && event.attributes) {
        const attrs = event.attributes;
        const text = typeof attrs.text === 'string' ? attrs.text : '';
        if (!text.trim()) return;
        const startSec = Number(attrs.startSec ?? 0);
        const endSec = Number(attrs.endSec ?? 0);
        const isFinal = attrs.isFinal === 'true' || attrs.isFinal === true;
        const speakerLabel = typeof attrs.speakerLabel === 'string' ? attrs.speakerLabel : undefined;

        setCaptions((prev) => {
          // Interim updates replace the last caption if still non-final.
          if (!isFinal && prev.length > 0 && !prev[prev.length - 1].isFinal) {
            const next = prev.slice(0, -1);
            next.push({
              id: prev[prev.length - 1].id,
              text, startSec, endSec, isFinal, speakerLabel,
              receivedAt: Date.now(),
            });
            return next;
          }
          const appended = [
            ...prev,
            { id: nextId++, text, startSec, endSec, isFinal, speakerLabel, receivedAt: Date.now() },
          ];
          // Keep the last 2 lines only — rolling Netflix-style display.
          return appended.slice(-2);
        });
      } else if (event.eventName === 'captions_toggled' && event.attributes) {
        const enabled =
          event.attributes.enabled === 'true' || event.attributes.enabled === true;
        setHostCaptionsEnabled(enabled);
        if (!enabled) setCaptions([]);
      }
    };

    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room]);

  return { captions, hostCaptionsEnabled };
}
