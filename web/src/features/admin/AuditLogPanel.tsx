import { useState, useEffect, useCallback } from 'react';
import { Card, Badge, EmptyState, SkeletonLine } from '../../components/social';

interface AuditEntry {
  sessionId: string;
  actionType: string;
  actorId: string;
  reason: string;
  createdAt: string;
  sessionType: string;
}

interface AuditLogPanelProps {
  authToken: string;
  apiBaseUrl: string;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const ACTION_CONFIG: Record<string, { variant: 'danger' | 'warning' | 'info' | 'light' | 'success'; label: string; dot: string }> = {
  ADMIN_KILL: { variant: 'danger', label: 'Admin Kill', dot: 'bg-red-500' },
  ML_FLAG: { variant: 'warning', label: 'ML Flag', dot: 'bg-yellow-500' },
  ML_AUTO_KILL: { variant: 'danger', label: 'Auto Kill', dot: 'bg-red-500' },
  AI_AGENT_JOIN: { variant: 'info', label: 'AI Agent Joined', dot: 'bg-purple-500' },
  AI_AGENT_LEAVE: { variant: 'light', label: 'AI Agent Left', dot: 'bg-gray-400' },
  AI_AGENT_SPEAK: { variant: 'info', label: 'AI Agent Spoke', dot: 'bg-purple-400' },
  INTENT_EXTRACTED: { variant: 'success', label: 'Intent Extracted', dot: 'bg-green-500' },
};

function getActionConfig(action: string) {
  return ACTION_CONFIG[action] ?? { variant: 'light' as const, label: action, dot: 'bg-gray-400' };
}

function describeAction(entry: AuditEntry): string {
  const sessionShort = entry.sessionId.slice(0, 8);
  switch (entry.actionType) {
    case 'ADMIN_KILL':
      return `Admin ${entry.actorId} killed session ${sessionShort}`;
    case 'ML_FLAG':
      return `ML flagged session ${sessionShort} (${entry.reason})`;
    case 'ML_AUTO_KILL':
      return `ML auto-killed session ${sessionShort} (${entry.reason})`;
    case 'AI_AGENT_JOIN':
      return `AI agent joined session ${sessionShort}`;
    case 'AI_AGENT_LEAVE':
      return `AI agent left session ${sessionShort}`;
    case 'AI_AGENT_SPEAK':
      return `AI agent spoke in session ${sessionShort}`;
    case 'INTENT_EXTRACTED':
      return `Intent extracted in session ${sessionShort}`;
    default:
      return `${entry.actorId} performed ${entry.actionType} on ${sessionShort}`;
  }
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-200 dark:bg-gray-700 shrink-0" />
          <SkeletonLine width="w-2/3" height="h-3" />
          <div className="ml-auto">
            <SkeletonLine width="w-16" height="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineEntry({ entry }: { entry: AuditEntry }) {
  const config = getActionConfig(entry.actionType);

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
      {/* Dot */}
      <div className="mt-1.5 shrink-0">
        <span className={`block w-2.5 h-2.5 rounded-full ${config.dot} ring-4 ring-white dark:ring-gray-800`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge variant={config.variant} size="sm">
            {config.label}
          </Badge>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {describeAction(entry)}
        </p>
        {entry.reason && entry.actionType === 'ADMIN_KILL' && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
            {entry.reason}
          </p>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap tabular-nums shrink-0 mt-0.5">
        {timeAgo(entry.createdAt)}
      </span>
    </div>
  );
}

type AuditType = 'moderation' | 'appeal' | 'agent';

const AUDIT_TYPE_OPTIONS: { key: AuditType; label: string }[] = [
  { key: 'moderation', label: 'Moderation' },
  { key: 'appeal', label: 'Appeals' },
  { key: 'agent', label: 'AI Agent' },
];

export function AuditLogPanel({ authToken, apiBaseUrl }: AuditLogPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditType, setAuditType] = useState<AuditType>('moderation');

  const fetchLog = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/audit-log?limit=50&type=${auditType}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl, auditType]);

  useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, 30_000);
    return () => clearInterval(interval);
  }, [fetchLog]);

  // Re-render to update relative timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="border border-gray-200 dark:border-gray-700">
      {/* Type filter tabs */}
      <div className="flex gap-1.5 p-3 border-b border-gray-100 dark:border-gray-700/50">
        {AUDIT_TYPE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setAuditType(opt.key)}
            className={`px-3 py-1 text-xs font-medium rounded-lg transition-all duration-200 cursor-pointer ${
              auditType === opt.key
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-4 mt-4 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No moderation actions recorded"
          description="Actions like session kills and ML flags will appear here."
          icon={
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          }
        />
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {entries.map((e, i) => (
            <TimelineEntry key={`${e.sessionId}-${e.createdAt}-${i}`} entry={e} />
          ))}
        </div>
      )}
    </Card>
  );
}
