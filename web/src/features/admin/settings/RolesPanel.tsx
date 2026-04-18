/**
 * Roles panel — manage Cognito group membership (admins for now).
 * Shows derived CASL permissions per role from the shared abilities builder.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchToken } from '../../../auth/fetchToken';
import { getConfig } from '../../../config/aws-config';
import { defineAbilityFor } from '../../../auth/abilities';

interface RoleMember {
  username: string;
  email?: string;
  status?: string;
  enabled?: boolean;
  createdAt?: string;
}

const ROLES = ['admin'] as const;
type Role = typeof ROLES[number];

function permissionsFor(role: Role): string[] {
  const ability = defineAbilityFor({ userId: 'preview', role });
  return ability.rules
    .map((r) => `${Array.isArray(r.action) ? r.action.join('|') : r.action} ${Array.isArray(r.subject) ? r.subject.join('|') : r.subject}`)
    .slice(0, 10);
}

export function RolesPanel() {
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [authToken, setAuthToken] = useState('');
  const [role, setRole] = useState<Role>('admin');
  const [members, setMembers] = useState<RoleMember[] | null>(null);
  const [error, setError] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const auth = useMemo(
    () => (authToken ? { Authorization: `Bearer ${authToken}` } : undefined),
    [authToken],
  );

  useEffect(() => {
    fetchToken().then(({ token }) => setAuthToken(token ?? '')).catch(() => setAuthToken(''));
  }, []);

  const load = useCallback(async () => {
    if (!auth) return;
    setError('');
    try {
      const r = await fetch(`${apiBaseUrl}/admin/roles/${role}/members`, { headers: auth });
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      setMembers(data.members ?? []);
    } catch (err: any) {
      setError(`Failed to load: ${err.message}`);
      setMembers([]);
    }
  }, [apiBaseUrl, auth, role]);

  useEffect(() => { load(); }, [load]);

  async function addMember() {
    if (!auth || !newUsername.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${apiBaseUrl}/admin/roles/${role}/members`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim() }),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error ?? `${r.status}`;
        throw new Error(msg);
      }
      setNewUsername('');
      await load();
    } catch (err: any) {
      setError(`Add failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(username: string) {
    if (!auth) return;
    if (!confirm(`Remove ${username} from ${role}?`)) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`${apiBaseUrl}/admin/roles/${role}/members/${encodeURIComponent(username)}`, {
        method: 'DELETE', headers: auth,
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error ?? `${r.status}`;
        throw new Error(msg);
      }
      await load();
    } catch (err: any) {
      setError(`Remove failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const perms = permissionsFor(role);

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Roles</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Assign Cognito group membership. Role permissions are derived from the shared CASL ability builder.
        </p>

        <div className="flex items-center gap-2 mb-4">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Role:</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-2 py-1"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="mb-4">
          <h4 className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Permissions</h4>
          <ul className="text-xs font-mono space-y-0.5 text-gray-700 dark:text-gray-300">
            {perms.map((p, i) => <li key={i}>• {p}</li>)}
          </ul>
        </div>

        <div className="mb-4">
          <h4 className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Members</h4>
          {!members ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No members.</p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
              {members.map((m) => (
                <li key={m.username} className="flex items-center justify-between px-3 py-2">
                  <div className="text-sm">
                    <span className="font-medium text-gray-900 dark:text-white">{m.username}</span>
                    {m.email && <span className="ml-2 text-gray-500 dark:text-gray-400">{m.email}</span>}
                  </div>
                  <button
                    onClick={() => removeMember(m.username!)}
                    disabled={busy}
                    className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/30 hover:bg-red-100 dark:hover:bg-red-500/20 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="username"
            className="flex-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5"
          />
          <button
            onClick={addMember}
            disabled={busy || !newUsername.trim()}
            className="text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            Add to {role}
          </button>
        </div>

        {error && (
          <div className="mt-3 text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
