/**
 * Hooks for the Phase 2 discovery endpoints. Each hook is a thin fetch
 * wrapper that returns { items, loading, error, refresh }.
 */
import { useEffect, useState } from 'react';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';
import type { DiscoverySessionItem } from './SessionCard';

export type FeedTab = 'live' | 'upcoming' | 'recent' | 'following';

interface DiscoveryState {
  items: DiscoverySessionItem[];
  loading: boolean;
  error: string | null;
}

/** GET /feed?tab=... — discovery feed. `following` requires auth. */
export function useFeed(tab: FeedTab): DiscoveryState & { refresh: () => void } {
  const [state, setState] = useState<DiscoveryState>({ items: [], loading: true, error: null });
  const [bump, setBump] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = getConfig();
      if (!cfg?.apiUrl) {
        setState({ items: [], loading: false, error: null });
        return;
      }
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        try {
          const { token } = await fetchToken();
          if (token) headers.Authorization = `Bearer ${token}`;
        } catch { /* anonymous tabs are fine */ }

        const res = await fetch(`${cfg.apiUrl}/feed?tab=${encodeURIComponent(tab)}`, { headers });
        if (!res.ok) {
          if (res.status === 401) {
            if (!cancelled) setState({ items: [], loading: false, error: 'Sign in to see this tab.' });
            return;
          }
          throw new Error(`${res.status}`);
        }
        const data = (await res.json()) as { items: DiscoverySessionItem[] };
        if (!cancelled) setState({ items: data.items ?? [], loading: false, error: null });
      } catch (err: any) {
        if (!cancelled) setState({ items: [], loading: false, error: err?.message ?? 'Failed to load feed' });
      }
    })();
    return () => { cancelled = true; };
  }, [tab, bump]);

  return { ...state, refresh: () => setBump((b) => b + 1) };
}

/** GET /search?q=...&filter=... */
export function useSessionSearch(
  q: string,
  filter?: 'live' | 'upcoming' | 'ended',
): DiscoveryState {
  const [state, setState] = useState<DiscoveryState>({ items: [], loading: false, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = getConfig();
      if (!cfg?.apiUrl) return;
      setState({ items: [], loading: true, error: null });
      try {
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (filter) params.set('filter', filter);
        const res = await fetch(`${cfg.apiUrl}/search?${params.toString()}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as { items: DiscoverySessionItem[] };
        if (!cancelled) setState({ items: data.items ?? [], loading: false, error: null });
      } catch (err: any) {
        if (!cancelled) setState({ items: [], loading: false, error: err?.message ?? 'Search failed' });
      }
    })();
    return () => { cancelled = true; };
  }, [q, filter]);

  return state;
}

/** GET /creators/{handle}/sessions?status=... */
export function useCreatorSessions(
  handle: string | undefined,
  status?: 'live' | 'ended',
): DiscoveryState {
  const [state, setState] = useState<DiscoveryState>({ items: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!handle) { setState({ items: [], loading: false, error: null }); return; }
      const cfg = getConfig();
      if (!cfg?.apiUrl) return;
      setState({ items: [], loading: true, error: null });
      try {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        const cleanHandle = handle.replace(/^@/, '');
        const url = `${cfg.apiUrl}/creators/${encodeURIComponent(cleanHandle)}/sessions${params.toString() ? `?${params.toString()}` : ''}`;
        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 404) {
            setState({ items: [], loading: false, error: 'not_found' });
            return;
          }
          throw new Error(`${res.status}`);
        }
        const data = (await res.json()) as { items: DiscoverySessionItem[] };
        if (!cancelled) setState({ items: data.items ?? [], loading: false, error: null });
      } catch (err: any) {
        if (!cancelled) setState({ items: [], loading: false, error: err?.message ?? 'Failed' });
      }
    })();
    return () => { cancelled = true; };
  }, [handle, status]);

  return state;
}
