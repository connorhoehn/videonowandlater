/**
 * InviteGroupModal — shown to the host of a HANGOUT session. Lists the host's
 * groups, lets them pick one, and POSTs to /sessions/{id}/invite-group to
 * bulk-invite every member.
 */
import { useCallback, useEffect, useState } from 'react';

type GroupRole = 'owner' | 'admin' | 'member';

interface Group {
  groupId: string;
  name: string;
  visibility: 'private' | 'public';
  myRole?: GroupRole;
}

interface InviteGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  authToken: string;
  apiBaseUrl: string;
  onInvited?: (result: { invitedCount: number; skippedCount: number }) => void;
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

export function InviteGroupModal({
  isOpen,
  onClose,
  sessionId,
  authToken,
  apiBaseUrl,
  onInvited,
}: InviteGroupModalProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ groups: Group[] }>(
        authToken,
        apiBaseUrl,
        '/groups/mine',
      );
      // Only owners/admins can invite, so filter client-side for nicer UX.
      const invitable = (res.groups ?? []).filter(
        (g) => g.myRole === 'owner' || g.myRole === 'admin',
      );
      setGroups(invitable);
      if (invitable.length > 0) setSelectedId(invitable[0].groupId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl]);

  useEffect(() => {
    if (isOpen) {
      setSuccessMsg(null);
      load();
    }
  }, [isOpen, load]);

  const submit = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api<{ invitedCount: number; skippedCount: number }>(
        authToken,
        apiBaseUrl,
        `/sessions/${encodeURIComponent(sessionId)}/invite-group`,
        {
          method: 'POST',
          body: JSON.stringify({ groupId: selectedId }),
        },
      );
      setSuccessMsg(
        `Invited ${res.invitedCount} member${res.invitedCount === 1 ? '' : 's'}` +
          (res.skippedCount > 0 ? ` (${res.skippedCount} skipped).` : '.'),
      );
      onInvited?.(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Invite from your groups
          </h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-8 h-8 rounded-full text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading your groups…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              You don't own or administer any groups yet. Create one from Settings → Groups first.
            </p>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Group
              </label>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {groups.map((g) => (
                  <option key={g.groupId} value={g.groupId}>
                    {g.name} ({g.myRole})
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Every member (except you and anyone already in the session) will receive a pending invitation.
              </p>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-xs">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/30 rounded-lg text-emerald-700 dark:text-emerald-400 text-xs">
              {successMsg}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !selectedId || groups.length === 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Inviting…' : 'Invite group'}
          </button>
        </div>
      </div>
    </div>
  );
}
