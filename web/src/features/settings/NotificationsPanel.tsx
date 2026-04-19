/**
 * NotificationsPanel — /settings/notifications
 *
 * Displays the full notification inbox backed by GET /me/notifications.
 * Supports mark-all-read and per-item navigation by type:
 *   - creator_live → /viewer/<sessionId> (BROADCAST) or /hangout/<sessionId> (HANGOUT)
 *   - session_invite → /settings/invites
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';

interface NotificationItem {
  recipientId: string;
  notificationId: string;
  createdAt: string;
  type: string;
  subject: string;
  payload: Record<string, unknown>;
  seen: boolean;
  readAt?: string;
}

async function api<T>(
  token: string,
  apiBaseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function routeForNotification(n: NotificationItem): string | null {
  if (n.type === 'creator_live') {
    const sessionId = n.payload?.sessionId as string | undefined;
    const sessionType = n.payload?.sessionType as string | undefined;
    if (!sessionId) return null;
    return sessionType === 'HANGOUT' ? `/hangout/${sessionId}` : `/viewer/${sessionId}`;
  }
  if (n.type === 'session_invite') return '/settings/invites';
  return null;
}

function NotificationIcon({ type }: { type: string }) {
  if (type === 'creator_live') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

export function NotificationsPanel() {
  const navigate = useNavigate();
  const apiBaseUrl = useMemo(() => getConfig()?.apiUrl ?? '', []);
  const [token, setToken] = useState('');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchToken()
      .then(({ token }) => setToken(token))
      .catch(() => setToken(''));
  }, []);

  const load = useCallback(async () => {
    if (!token || !apiBaseUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ items: NotificationItem[]; unreadCount: number }>(
        token,
        apiBaseUrl,
        '/me/notifications?limit=100',
      );
      setItems(res.items);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, apiBaseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const markRead = async (n: NotificationItem) => {
    if (n.seen) return;
    // Optimistic update — the bell-icon poll will reconcile if it fails.
    setItems((prev) =>
      prev.map((i) =>
        i.notificationId === n.notificationId ? { ...i, seen: true } : i,
      ),
    );
    try {
      await api(
        token,
        apiBaseUrl,
        `/me/notifications/${encodeURIComponent(n.notificationId)}/read`,
        {
          method: 'POST',
          body: JSON.stringify({ createdAt: n.createdAt }),
        },
      );
    } catch {
      /* silent — will be retried on next refresh */
    }
  };

  const markAllRead = async () => {
    const unread = items.filter((i) => !i.seen);
    if (unread.length === 0) return;
    setItems((prev) => prev.map((i) => ({ ...i, seen: true })));
    // Fire-and-forget batch of single-item mark-read calls.
    await Promise.allSettled(
      unread.map((n) =>
        api(
          token,
          apiBaseUrl,
          `/me/notifications/${encodeURIComponent(n.notificationId)}/read`,
          {
            method: 'POST',
            body: JSON.stringify({ createdAt: n.createdAt }),
          },
        ),
      ),
    );
  };

  const openItem = (n: NotificationItem) => {
    markRead(n);
    const to = routeForNotification(n);
    if (to) navigate(to);
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Notifications
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Activity from creators you follow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={markAllRead}
            disabled={items.every((i) => i.seen)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            Mark all read
          </button>
          <button
            type="button"
            onClick={load}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          You don&apos;t have any notifications yet.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {items.map((n) => {
            const to = routeForNotification(n);
            return (
              <li
                key={n.notificationId}
                className={`py-4 flex items-start gap-3 ${n.seen ? '' : 'bg-blue-50/40 dark:bg-blue-900/10 -mx-4 px-4 rounded'}`}
              >
                <span className="shrink-0 w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center">
                  <NotificationIcon type={n.type} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {n.subject}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {relativeTime(n.createdAt)}
                    {!n.seen && (
                      <span className="ml-2 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        New
                      </span>
                    )}
                  </p>
                </div>
                {to && (
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    View
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
