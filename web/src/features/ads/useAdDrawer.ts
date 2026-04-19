/**
 * useAdDrawer — host-side hook fetching the promo drawer + triggering creatives.
 *
 * Fetches GET /sessions/{id}/promo/drawer on mount + on refresh.
 * `trigger(creativeId)` POSTs /sessions/{id}/promo/trigger.
 *
 * When the backend feature flag is off, `items` is [] and `trigger()` still
 * resolves without error — the UI should render an empty state.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';
import type { DrawerItem } from './types';

export type TriggerReason =
  | 'cap_reached'
  | 'schedule_out_of_window'
  | 'no_creative'
  | 'no_overlay'
  | 'ads_disabled'
  | 'no_channel'
  | 'no_chat_room'
  | 'unsupported_session_type'
  | string;

export interface TriggerResult {
  delivered: boolean;
  reason?: TriggerReason;
}

interface UseAdDrawerResult {
  items: DrawerItem[];
  loading: boolean;
  error: string | null;
  triggering: boolean;
  /** creativeIds that returned a capped/out-of-window reason this session. */
  cappedCreativeIds: Set<string>;
  refresh: () => Promise<void>;
  trigger: (creativeId: string) => Promise<TriggerResult>;
}

export function useAdDrawer(sessionId: string | undefined): UseAdDrawerResult {
  const [items, setItems] = useState<DrawerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cappedCreativeIds, setCappedCreativeIds] = useState<Set<string>>(() => new Set());

  const apiBaseUrl = getConfig()?.apiUrl || 'http://localhost:3000/api';

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const { token } = await fetchToken();
      const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/promo/drawer`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // 403 (not owner) / 404 — treat as empty to keep the panel friendly
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, sessionId]);

  const trigger = useCallback(
    async (creativeId: string): Promise<TriggerResult> => {
      if (!sessionId) return { delivered: false };
      setTriggering(true);
      try {
        const { token } = await fetchToken();
        const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/promo/trigger`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ creativeId, triggerType: 'manual' }),
        });
        if (!res.ok) return { delivered: false };
        const data = await res.json();
        const reason: TriggerReason | undefined = data?.reason;
        // Track creatives that vnl-ads reports capped/out-of-window so the UI
        // can grey them out. Other reasons (unsupported session type, feature
        // flag off) aren't per-creative and don't affect the drawer.
        if (reason === 'cap_reached' || reason === 'schedule_out_of_window') {
          setCappedCreativeIds((prev) => {
            if (prev.has(creativeId)) return prev;
            const next = new Set(prev);
            next.add(creativeId);
            return next;
          });
        }
        return { delivered: !!data?.delivered, reason };
      } catch {
        return { delivered: false };
      } finally {
        setTriggering(false);
      }
    },
    [apiBaseUrl, sessionId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, error, triggering, cappedCreativeIds, refresh, trigger };
}
