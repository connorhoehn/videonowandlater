import { useState, useEffect, useCallback } from 'react';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';
import { ActiveSessionsPanel } from './ActiveSessionsPanel';
import { CostSummaryPanel } from './CostSummaryPanel';
import { AuditLogPanel } from './AuditLogPanel';
import { ModerationQueuePanel } from './ModerationQueuePanel';
import { AppealsPanel } from './AppealsPanel';

type TabId = 'sessions' | 'costs' | 'audit' | 'moderation' | 'appeals';

const TABS: { id: TabId; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'costs', label: 'Costs' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'moderation', label: 'Moderation Queue' },
  { id: 'appeals', label: 'Appeals' },
];

interface QuickStats {
  activeSessions: number | null;
  todayCost: number | null;
  pendingFlags: number | null;
  appeals: number | null;
}

function formatStatCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('sessions');
  const [authToken, setAuthToken] = useState('');
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [stats, setStats] = useState<QuickStats>({
    activeSessions: null,
    todayCost: null,
    pendingFlags: null,
    appeals: null,
  });

  const loadToken = useCallback(async () => {
    try {
      const { token } = await fetchToken();
      setAuthToken(token);
    } catch {
      // token fetch failed — panels will handle missing auth individually
    }
  }, []);

  useEffect(() => {
    loadToken();
  }, [loadToken]);

  /* Fetch quick stats once we have auth */
  useEffect(() => {
    if (!authToken || !apiBaseUrl) return;

    const today = new Date().toISOString().split('T')[0];

    // Fetch sessions count
    fetch(`${apiBaseUrl}/admin/sessions`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { sessions?: { status: string }[] } | { status: string }[]) => {
        const sessions = Array.isArray(data) ? data : data.sessions ?? [];
        const liveCount = sessions.filter(
          (s: { status: string }) => s.status === 'live' || s.status === 'ACTIVE',
        ).length;
        setStats((prev) => ({ ...prev, activeSessions: liveCount }));
      })
      .catch(() => setStats((prev) => ({ ...prev, activeSessions: null })));

    // Fetch today's cost
    fetch(`${apiBaseUrl}/admin/costs/summary?period=daily&date=${today}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { totalCostUsd?: number }) => {
        setStats((prev) => ({ ...prev, todayCost: data.totalCostUsd ?? 0 }));
      })
      .catch(() => setStats((prev) => ({ ...prev, todayCost: null })));
  }, [authToken, apiBaseUrl]);

  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-[calc(100vh-64px)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Admin
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Monitor sessions, costs, audit logs, and moderation flags.
          </p>
        </header>

        {/* Quick stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Active Sessions" value={stats.activeSessions !== null ? String(stats.activeSessions) : '--'} />
          <StatCard label="Today's Cost" value={stats.todayCost !== null ? formatStatCost(stats.todayCost) : '--'} />
          <StatCard label="Pending Flags" value={stats.pendingFlags !== null ? String(stats.pendingFlags) : '\u2014'} />
          <StatCard label="Appeals" value={stats.appeals !== null ? String(stats.appeals) : '\u2014'} />
        </div>

        {/* Tab bar */}
        <nav className="flex gap-1.5 mb-6 p-1 bg-white/15 dark:bg-white/10 rounded-xl w-fit" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Active panel */}
        <div>
          {activeTab === 'sessions' && <ActiveSessionsPanel authToken={authToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'costs' && <CostSummaryPanel authToken={authToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'audit' && <AuditLogPanel authToken={authToken} apiBaseUrl={apiBaseUrl} />}
          {activeTab === 'moderation' && (
            <ModerationQueuePanel authToken={authToken} apiBaseUrl={apiBaseUrl} />
          )}
          {activeTab === 'appeals' && (
            <AppealsPanel authToken={authToken} apiBaseUrl={apiBaseUrl} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums mt-1">
        {value}
      </p>
    </div>
  );
}
