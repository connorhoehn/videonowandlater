import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';
import { useAuth } from '../../auth/useAuth';

type Visibility = 'private' | 'public';
type GroupRole = 'owner' | 'admin' | 'member';

interface Group {
  groupId: string;
  ownerId: string;
  name: string;
  description?: string;
  visibility: Visibility;
  createdAt: string;
  myRole?: GroupRole;
}

interface Member {
  groupId: string;
  userId: string;
  groupRole: GroupRole;
  addedAt: string;
  addedBy: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

interface BaseProps {
  token: string;
  apiBaseUrl: string;
}

function CreateGroupForm({ token, apiBaseUrl, onCreated }: BaseProps & { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(token, apiBaseUrl, '/groups', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim(), visibility }),
      });
      setName('');
      setDescription('');
      setVisibility('private');
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
        Create a new group
      </h3>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Close friends"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="What's this group about?"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
          Visibility
        </label>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
          className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="private">Private (members only)</option>
          <option value="public">Public (anyone can see)</option>
        </select>
      </div>
      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-xs">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}

function GroupListItem({
  group,
  onSelect,
  selected,
}: {
  group: Group;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${
        selected
          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-500/40'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
          {group.name}
        </span>
        <span
          className={`shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium border ${
            group.visibility === 'public'
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
              : 'bg-gray-200/70 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 border-gray-300/50 dark:border-gray-600/50'
          }`}
        >
          {group.visibility}
        </span>
      </div>
      {group.description && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
          {group.description}
        </p>
      )}
      {group.myRole && (
        <span className="mt-2 inline-flex text-[10px] uppercase tracking-wider font-medium text-gray-500 dark:text-gray-400">
          Your role: {group.myRole}
        </span>
      )}
    </button>
  );
}

function GroupDetail({
  group,
  token,
  apiBaseUrl,
  currentUserId,
  onDeleted,
}: BaseProps & {
  group: Group;
  currentUserId: string;
  onDeleted: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviting, setInviting] = useState(false);

  const isOwnerOrAdmin =
    group.ownerId === currentUserId ||
    group.myRole === 'owner' ||
    group.myRole === 'admin';
  const isOwner = group.ownerId === currentUserId || group.myRole === 'owner';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ group: Group; members: Member[] }>(
        token,
        apiBaseUrl,
        `/groups/${encodeURIComponent(group.groupId)}`,
      );
      setMembers(res.members);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, apiBaseUrl, group.groupId]);

  useEffect(() => { load(); }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteUsername.trim()) return;
    setInviting(true);
    setError(null);
    try {
      await api(token, apiBaseUrl, `/groups/${encodeURIComponent(group.groupId)}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: inviteUsername.trim() }),
      });
      setInviteUsername('');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setInviting(false);
    }
  };

  const remove = async (userId: string) => {
    setError(null);
    try {
      await api(token, apiBaseUrl, `/groups/${encodeURIComponent(group.groupId)}/members/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const promote = async (userId: string, newRole: 'admin' | 'member') => {
    setError(null);
    try {
      await api(token, apiBaseUrl, `/groups/${encodeURIComponent(group.groupId)}/members/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ groupRole: newRole }),
      });
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deleteGroup = async () => {
    if (!confirm(`Delete group "${group.name}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await api(token, apiBaseUrl, `/groups/${encodeURIComponent(group.groupId)}`, {
        method: 'DELETE',
      });
      onDeleted();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {group.name}
          </h3>
          {group.description && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {group.description}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
            Owner: <span className="font-mono">{group.ownerId}</span> · {group.visibility}
          </p>
        </div>
        {isOwner && (
          <button
            onClick={deleteGroup}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer"
          >
            Delete group
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-xs">
          {error}
        </div>
      )}

      {isOwnerOrAdmin && (
        <form onSubmit={invite} className="mt-5 flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
              Invite by username
            </label>
            <input
              type="text"
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              placeholder="username"
              className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={inviting || !inviteUsername.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {inviting ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}

      <div className="mt-5">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          Members ({members.length})
        </h4>
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No members yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {members.map((m) => {
              const isMe = m.userId === currentUserId;
              const canEdit = isOwner && m.userId !== group.ownerId;
              const canRemove =
                (isOwnerOrAdmin && m.userId !== group.ownerId) || isMe;
              return (
                <li key={m.userId} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      <span className="font-mono">{m.userId}</span>
                      {isMe && <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">(you)</span>}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                      {m.groupRole}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {canEdit && m.groupRole !== 'admin' && (
                      <button
                        onClick={() => promote(m.userId, 'admin')}
                        className="px-2 py-1 rounded text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-500/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors cursor-pointer"
                      >
                        Promote
                      </button>
                    )}
                    {canEdit && m.groupRole === 'admin' && (
                      <button
                        onClick={() => promote(m.userId, 'member')}
                        className="px-2 py-1 rounded text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600/50 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                      >
                        Demote
                      </button>
                    )}
                    {canRemove && (
                      <button
                        onClick={() => remove(m.userId)}
                        className="px-2 py-1 rounded text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer"
                      >
                        {isMe ? 'Leave' : 'Remove'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export function GroupsPanel() {
  const { user } = useAuth();
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [token, setToken] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadToken = useCallback(async () => {
    try {
      const { token } = await fetchToken();
      setToken(token);
    } catch {
      /* handled by panel's empty state */
    }
  }, []);

  const loadGroups = useCallback(async () => {
    if (!token || !apiBaseUrl) return;
    setLoading(true);
    try {
      const res = await api<{ groups: Group[] }>(token, apiBaseUrl, '/groups/mine');
      setGroups(res.groups);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token, apiBaseUrl]);

  useEffect(() => { loadToken(); }, [loadToken]);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.groupId === selectedId) ?? null,
    [groups, selectedId],
  );

  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
        Groups
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Create and manage groups you own or belong to.
      </p>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-5">
        <div className="space-y-4">
          <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <CreateGroupForm token={token} apiBaseUrl={apiBaseUrl} onCreated={loadGroups} />
          </div>

          <div>
            <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Your groups
            </h3>
            {loading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">You're not in any groups yet.</p>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => (
                  <GroupListItem
                    key={g.groupId}
                    group={g}
                    selected={g.groupId === selectedId}
                    onSelect={() => setSelectedId(g.groupId)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          {selectedGroup ? (
            <GroupDetail
              group={selectedGroup}
              token={token}
              apiBaseUrl={apiBaseUrl}
              currentUserId={user?.username ?? ''}
              onDeleted={() => {
                setSelectedId(null);
                loadGroups();
              }}
            />
          ) : (
            <div className="h-full min-h-[200px] flex items-center justify-center bg-gray-50 dark:bg-gray-900/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-sm text-gray-500 dark:text-gray-400">
              Select a group on the left to view details.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
