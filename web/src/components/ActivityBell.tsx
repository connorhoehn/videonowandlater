/**
 * ActivityBell — the navbar bell icon.
 *
 * Combines two sources of unread activity:
 *   1. Pending session invitations (GET /invites/mine?status=pending)
 *   2. Unread inbox notifications (GET /me/notifications?unread=1)
 *
 * The badge count is the sum; the dropdown shows both feeds via a tab switcher.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchToken } from '../auth/fetchToken';
import { getConfig } from '../config/aws-config';
import { BellIcon } from './social/Icons';

interface NotificationItem {
  recipientId: string;
  notificationId: string;
  createdAt: string;
  type: string;
  subject: string;
  payload: Record<string, unknown>;
  seen: boolean;
}

interface InviteItem {
  sessionId: string;
  inviterId: string;
  invitedAt: string;
  status: string;
  source: string;
  session: { sessionType?: string } | null;
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

interface ActivityBellProps {
  pendingInviteCount: number;
}

export function ActivityBell({ pendingInviteCount }: ActivityBellProps) {
  const navigate = useNavigate();
  const apiBaseUrl = useMemo(() => getConfig()?.apiUrl ?? '', []);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'notifications' | 'invites'>('notifications');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Poll unread notifications (subject + count) on a 30s cadence.
  useEffect(() => {
    if (!apiBaseUrl) return;
    let cancelled = false;
    const fetchNotifs = async () => {
      try {
        const { token } = await fetchToken();
        if (!token || cancelled) return;
        const res = await fetch(`${apiBaseUrl}/me/notifications?limit=20`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          items?: NotificationItem[];
          unreadCount?: number;
        };
        if (!cancelled) {
          setNotifications(data.items ?? []);
          setUnreadCount(data.unreadCount ?? 0);
        }
      } catch {
        /* silent */
      }
    };
    fetchNotifs();
    const id = window.setInterval(fetchNotifs, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apiBaseUrl]);

  // Fetch invites list when the user opens the dropdown and switches to that tab.
  const loadInvites = useCallback(async () => {
    if (!apiBaseUrl) return;
    try {
      const { token } = await fetchToken();
      if (!token) return;
      const res = await fetch(`${apiBaseUrl}/invites/mine?status=pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { invites?: InviteItem[] };
      setInvites(data.invites ?? []);
    } catch {
      /* silent */
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (open && tab === 'invites') void loadInvites();
  }, [open, tab, loadInvites]);

  // Click-outside + Escape handlers.
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const totalBadge = unreadCount + pendingInviteCount;

  const markNotifRead = async (n: NotificationItem) => {
    if (n.seen) return;
    setNotifications((prev) =>
      prev.map((i) => (i.notificationId === n.notificationId ? { ...i, seen: true } : i)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      const { token } = await fetchToken();
      if (!token) return;
      await fetch(
        `${apiBaseUrl}/me/notifications/${encodeURIComponent(n.notificationId)}/read`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ createdAt: n.createdAt }),
        },
      );
    } catch {
      /* silent */
    }
  };

  const openNotif = (n: NotificationItem) => {
    void markNotifRead(n);
    const to = routeForNotification(n);
    setOpen(false);
    if (to) navigate(to);
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 flex items-center justify-center relative cursor-pointer"
        aria-label={`Activity${totalBadge > 0 ? ` (${totalBadge} new)` : ''}`}
        title={totalBadge > 0 ? `${totalBadge} new` : 'Activity'}
      >
        <BellIcon size={18} />
        {totalBadge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
            {totalBadge > 99 ? '99+' : totalBadge}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-96 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 max-h-[28rem] overflow-hidden"
          style={{ animation: 'dropdown-in 150ms ease-out' }}
        >
          <style>{`
            @keyframes dropdown-in {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>

          {/* Tab header */}
          <div className="px-2 pt-2 border-b border-gray-100 dark:border-gray-700 flex gap-1">
            {(['notifications', 'invites'] as const).map((t) => {
              const active = tab === t;
              const count = t === 'notifications' ? unreadCount : pendingInviteCount;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors cursor-pointer ${
                    active
                      ? 'text-gray-900 dark:text-white border-b-2 border-blue-500 -mb-px'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {t === 'notifications' ? 'Notifications' : 'Invites'}
                  {count > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="overflow-y-auto max-h-80">
            {tab === 'notifications' ? (
              notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No notifications
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.notificationId}
                    type="button"
                    onClick={() => openNotif(n)}
                    className={`w-full text-left flex gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${
                      !n.seen ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 dark:text-gray-200 line-clamp-2">
                        {n.subject}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {relativeTime(n.createdAt)}
                      </p>
                    </div>
                    {!n.seen && (
                      <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-2" />
                    )}
                  </button>
                ))
              )
            ) : invites.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                No pending invites
              </div>
            ) : (
              invites.map((inv) => (
                <button
                  key={inv.sessionId}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate('/settings/invites');
                  }}
                  className="w-full text-left flex flex-col gap-0.5 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                >
                  <p className="text-sm text-gray-700 dark:text-gray-200">
                    <span className="font-semibold">{inv.inviterId}</span>
                    {' invited you to a '}
                    {inv.session?.sessionType ?? 'session'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {relativeTime(inv.invitedAt)}
                  </p>
                </button>
              ))
            )}
          </div>

          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 text-center">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(
                  tab === 'notifications' ? '/settings/notifications' : '/settings/invites',
                );
              }}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
            >
              {tab === 'notifications' ? 'View all notifications' : 'View all invites'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
