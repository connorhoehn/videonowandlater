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

interface UseAdDrawerResult {
  items: DrawerItem[];
  loading: boolean;
  error: string | null;
  triggering: boolean;
  refresh: () => Promise<void>;
  trigger: (creativeId: string) => Promise<{ delivered: boolean }>;
}

export function useAdDrawer(sessionId: string | undefined): UseAdDrawerResult {
  const [items, setItems] = useState<DrawerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    async (creativeId: string): Promise<{ delivered: boolean }> => {
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
        return { delivered: !!data?.delivered };
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

  return { items, loading, error, triggering, refresh, trigger };
}
