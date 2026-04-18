import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';

type InvitationStatus = 'pending' | 'accepted' | 'declined';

interface InviteSession {
  sessionId: string;
  sessionType: string;
  hostUserId: string;
  createdAt: string;
  status: string;
}

interface Invite {
  sessionId: string;
  userId: string;
  inviterId: string;
  invitedAt: string;
  source: string;
  status: InvitationStatus;
  session: InviteSession | null;
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

export function InvitesPanel() {
  const navigate = useNavigate();
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [token, setToken] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
      const res = await api<{ invites: Invite[] }>(
        token,
        apiBaseUrl,
        '/invites/mine?status=pending',
      );
      setInvites(res.invites);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, apiBaseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (sessionId: string, action: 'accept' | 'decline') => {
    setBusyId(sessionId);
    setError(null);
    try {
      await api(
        token,
        apiBaseUrl,
        `/invites/${encodeURIComponent(sessionId)}/respond`,
        {
          method: 'POST',
          body: JSON.stringify({ action }),
        },
      );
      if (action === 'accept') {
        navigate(`/hangout/${sessionId}`);
      } else {
        setInvites((prev) => prev.filter((i) => i.sessionId !== sessionId));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            Invitations
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Pending invites to join hangouts and sessions.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
      ) : invites.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          You have no pending invitations.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {invites.map((inv) => {
            const groupSource = inv.source.startsWith('group:')
              ? inv.source.slice('group:'.length)
              : null;
            return (
              <li
                key={inv.sessionId}
                className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    <span className="font-mono">{inv.inviterId}</span> invited
                    you to a {inv.session?.sessionType ?? 'session'}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {relativeTime(inv.invitedAt)}
                    {groupSource && (
                      <>
                        {' · via group '}
                        <span className="font-mono">{groupSource}</span>
                      </>
                    )}
                    {inv.session?.status && (
                      <>
                        {' · '}
                        <span className="capitalize">{inv.session.status}</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === inv.sessionId}
                    onClick={() => respond(inv.sessionId, 'decline')}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    disabled={busyId === inv.sessionId}
                    onClick={() => respond(inv.sessionId, 'accept')}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {busyId === inv.sessionId ? 'Joining…' : 'Accept & join'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
