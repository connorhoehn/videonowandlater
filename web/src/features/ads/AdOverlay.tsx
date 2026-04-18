/**
 * AdOverlay — viewer-side sponsor/product overlay.
 *
 * BROADCAST: subscribes to the IVS Player's TEXT_METADATA_CUE events. We key
 * off `window.IVSPlayer.PlayerEventType.TEXT_METADATA_CUE` to avoid pinning
 * to the SDK's TypeScript types (the `amazon-ivs-player` package is optional
 * to import directly — the viewer page currently uses the global
 * `window.IVSPlayer` created by the CDN script).
 *
 * HANGOUT: subscribes to IVS Chat events with `eventName === 'ad_overlay'`.
 * The attribute `payload` is a JSON-stringified OverlayPayload.
 *
 * Renders a lower-third banner (sponsor) or product pin card for
 * `durationMs`, then auto-dismisses. Clicking POSTs /sessions/{id}/promo/click
 * and opens the returned `ctaUrl` in a new tab.
 */

import { useEffect, useState, useCallback } from 'react';
import type { ChatRoom } from 'amazon-ivs-chat-messaging';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';
import type { OverlayPayload } from './types';

interface AdOverlayProps {
  sessionId: string;
  /** True for BROADCAST viewer pages, false for HANGOUT pages. */
  isBroadcast: boolean;
  /** IVS Player instance (only used when isBroadcast=true). */
  player?: unknown;
  /** IVS Chat room instance (only used when isBroadcast=false). */
  room?: ChatRoom;
}

interface ActiveOverlay {
  payload: OverlayPayload;
  expiresAt: number;
}

const DEFAULT_DURATION_MS = 8000;

export function AdOverlay({ sessionId, isBroadcast, player, room }: AdOverlayProps) {
  const [active, setActive] = useState<ActiveOverlay | null>(null);
  const apiBaseUrl = getConfig()?.apiUrl || 'http://localhost:3000/api';

  const show = useCallback((payload: OverlayPayload) => {
    const duration =
      typeof payload.durationMs === 'number' && payload.durationMs > 0
        ? payload.durationMs
        : DEFAULT_DURATION_MS;
    setActive({ payload, expiresAt: Date.now() + duration });
  }, []);

  // Auto-dismiss
  useEffect(() => {
    if (!active) return;
    const remaining = active.expiresAt - Date.now();
    if (remaining <= 0) {
      setActive(null);
      return;
    }
    const timer = setTimeout(() => setActive(null), remaining);
    return () => clearTimeout(timer);
  }, [active]);

  // BROADCAST: hook into TEXT_METADATA_CUE via global window.IVSPlayer
  useEffect(() => {
    if (!isBroadcast || !player) return;
    const g = (window as unknown as { IVSPlayer?: { PlayerEventType?: { TEXT_METADATA_CUE?: string } } }).IVSPlayer;
    const eventName = g?.PlayerEventType?.TEXT_METADATA_CUE;
    if (!eventName) return;

    const p = player as { addEventListener?: (e: string, cb: (cue: { text?: string }) => void) => void; removeEventListener?: (e: string, cb: unknown) => void };
    if (typeof p.addEventListener !== 'function') return;

    const handler = (cue: { text?: string }) => {
      if (!cue?.text) return;
      try {
        const parsed = JSON.parse(cue.text) as OverlayPayload;
        if (parsed?.type === 'ad') show(parsed);
      } catch {
        // ignore non-JSON metadata
      }
    };
    p.addEventListener(eventName, handler);
    return () => {
      if (typeof p.removeEventListener === 'function') {
        p.removeEventListener(eventName, handler);
      }
    };
  }, [isBroadcast, player, show]);

  // HANGOUT: hook into IVS Chat ad_overlay events
  useEffect(() => {
    if (isBroadcast || !room) return;
    const handler = (event: { eventName?: string; attributes?: Record<string, string> }) => {
      if (event?.eventName !== 'ad_overlay') return;
      const raw = event.attributes?.payload;
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as OverlayPayload;
        if (parsed?.type === 'ad') show(parsed);
      } catch {
        // ignore malformed payload
      }
    };
    const unsubscribe = room.addListener('event', handler);
    return unsubscribe;
  }, [isBroadcast, room, show]);

  const handleClick = useCallback(async () => {
    if (!active) return;
    const creativeId = active.payload.creativeId;
    if (!creativeId) return;
    try {
      const { token } = await fetchToken();
      const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/promo/click`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ creativeId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.ctaUrl) {
        window.open(String(data.ctaUrl), '_blank', 'noopener,noreferrer');
      }
    } catch {
      // swallow — overlay click is best-effort
    }
  }, [active, apiBaseUrl, sessionId]);

  if (!active) return null;

  const title = typeof active.payload.title === 'string' ? active.payload.title : 'Sponsored';
  const imageUrl = typeof active.payload.imageUrl === 'string' ? active.payload.imageUrl : undefined;
  const isProduct = active.payload.overlayType === 'product_pin';

  return (
    <div
      className={`absolute pointer-events-auto z-20 ${
        isProduct
          ? 'top-4 right-4 max-w-[260px]'
          : 'bottom-4 left-4 right-4 sm:right-auto sm:max-w-[420px]'
      }`}
    >
      <button
        onClick={() => void handleClick()}
        className="w-full text-left bg-black/80 backdrop-blur-sm text-white rounded-lg shadow-lg border border-white/10 p-3 flex items-center gap-3 hover:bg-black/90 transition-colors"
        aria-label={`Sponsor: ${title}`}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="w-12 h-12 rounded object-cover flex-shrink-0 bg-white/10"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-white/60">
            {isProduct ? 'Shop' : 'Sponsored'}
          </div>
          <div className="text-sm font-semibold truncate">{title}</div>
        </div>
        <span
          className="text-xs text-white/60 hover:text-white flex-shrink-0"
          aria-hidden="true"
        >
          →
        </span>
      </button>
    </div>
  );
}
