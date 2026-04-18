/**
 * BannedUsersPanel — admin UI to manage global (cross-session) chat bans.
 *
 * Phase 3: Standalone panel used both from the Admin Dashboard tab bar and
 * (eventually) from the settings shell once Phase 1 lands. The component is
 * self-contained and only depends on an authToken + apiBaseUrl so it can be
 * dropped into either location.
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, EmptyState, SkeletonLine, useToast } from '../../components/social';

interface GlobalBan {
  userId: string;
  bannedBy: string;
  reason: string;
  bannedAt: string;
  expiresAt?: string;
}

interface BannedUsersPanelProps {
  authToken: string;
  apiBaseUrl: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2">
          <SkeletonLine width="w-1/3" height="h-4" />
          <SkeletonLine width="w-full" height="h-3" />
        </div>
      ))}
    </div>
  );
}

export function BannedUsersPanel({ authToken, apiBaseUrl }: BannedUsersPanelProps) {
  const { addToast } = useToast();
  const [bans, setBans] = useState<GlobalBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liftingUserId, setLiftingUserId] = useState<string | null>(null);

  // Form state
  const [formUserId, setFormUserId] = useState('');
  const [formReason, setFormReason] = useState('');
  const [formTtlDays, setFormTtlDays] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const fetchBans = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const res = await fetch(`${apiBaseUrl}/admin/bans`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBans(data.bans ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl]);

  useEffect(() => {
    fetchBans();
  }, [fetchBans]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUserId.trim() || !formReason.trim()) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        userId: formUserId.trim(),
        reason: formReason.trim(),
      };
      const ttl = parseInt(formTtlDays, 10);
      if (!Number.isNaN(ttl) && ttl > 0) body.ttlDays = ttl;

      const res = await fetch(`${apiBaseUrl}/admin/bans`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      addToast({ variant: 'success', title: 'User banned globally', description: formUserId.trim() });
      setFormUserId('');
      setFormReason('');
      setFormTtlDays('');
      await fetchBans();
    } catch (err: any) {
      addToast({ variant: 'error', title: 'Failed to create ban', description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleLift = async (userId: string) => {
    if (!window.confirm(`Lift the global ban for ${userId}?`)) return;
    setLiftingUserId(userId);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/bans/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      addToast({ variant: 'success', title: 'Global ban lifted', description: userId });
      await fetchBans();
    } catch (err: any) {
      addToast({ variant: 'error', title: 'Failed to lift ban', description: err.message });
    } finally {
      setLiftingUserId(null);
    }
  };

  return (
    <Card className="border border-gray-200 dark:border-gray-700">
      {/* Add ban form */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
          Add global ban
        </h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            type="text"
            placeholder="User ID"
            value={formUserId}
            onChange={(e) => setFormUserId(e.target.value)}
            required
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          <input
            type="text"
            placeholder="Reason"
            value={formReason}
            onChange={(e) => setFormReason(e.target.value)}
            required
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white sm:col-span-2"
          />
          <input
            type="number"
            placeholder="TTL (days, optional)"
            value={formTtlDays}
            onChange={(e) => setFormTtlDays(e.target.value)}
            min={1}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          <button
            type="submit"
            disabled={submitting || !formUserId.trim() || !formReason.trim()}
            className="sm:col-span-4 px-4 py-2 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {submitting ? 'Banning...' : 'Ban globally'}
          </button>
        </form>
      </div>

      {/* Ban list */}
      {error && (
        <div className="mx-4 mt-4 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : bans.length === 0 ? (
        <EmptyState
          title="No global bans"
          description="Users banned globally will be unable to obtain a chat token on any session."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-2 text-left font-medium">User ID</th>
                <th className="px-4 py-2 text-left font-medium">Banned by</th>
                <th className="px-4 py-2 text-left font-medium">Reason</th>
                <th className="px-4 py-2 text-left font-medium">Banned at</th>
                <th className="px-4 py-2 text-left font-medium">Expires</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {bans.map((ban) => (
                <tr key={ban.userId} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-2 font-mono text-xs text-gray-900 dark:text-white">
                    {ban.userId}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {ban.bannedBy}
                  </td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300 max-w-xs truncate" title={ban.reason}>
                    {ban.reason}
                  </td>
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formatDate(ban.bannedAt)}
                  </td>
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {ban.expiresAt ? formatDate(ban.expiresAt) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => handleLift(ban.userId)}
                      disabled={liftingUserId === ban.userId}
                      className="px-3 py-1 text-xs font-medium rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {liftingUserId === ban.userId ? '...' : 'Lift'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
