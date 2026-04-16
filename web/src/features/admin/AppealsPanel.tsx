import { useState, useEffect, useCallback } from 'react';
import { Card, Badge, EmptyState, SkeletonLine } from '../../components/social';

interface AppealEntry {
  sessionId: string;
  userId: string;
  reason: string;
  status: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
}

interface AppealsPanelProps {
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

const STATUS_CONFIG: Record<string, { variant: 'warning' | 'info' | 'danger' | 'light'; label: string }> = {
  pending: { variant: 'warning', label: 'Pending' },
  approved: { variant: 'info', label: 'Approved' },
  denied: { variant: 'danger', label: 'Denied' },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { variant: 'light' as const, label: status };
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2">
          <SkeletonLine width="w-1/3" height="h-4" />
          <SkeletonLine width="w-full" height="h-3" />
          <SkeletonLine width="w-2/3" height="h-3" />
        </div>
      ))}
    </div>
  );
}

function AppealCard({
  appeal,
  onReview,
  reviewing,
}: {
  appeal: AppealEntry;
  onReview: (sessionId: string, action: 'approve' | 'deny') => void;
  reviewing: string | null;
}) {
  const config = getStatusConfig(appeal.status);
  const isPending = appeal.status === 'pending';
  const isReviewing = reviewing === appeal.sessionId;

  return (
    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={config.variant} size="sm">
              {config.label}
            </Badge>
            <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
              {timeAgo(appeal.createdAt)}
            </span>
          </div>

          <p className="text-sm font-medium text-gray-900 dark:text-white mb-0.5">
            Session {appeal.sessionId.slice(0, 8)}...
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Appealed by <span className="font-medium">{appeal.userId}</span>
          </p>

          <div className="bg-gray-100 dark:bg-gray-800 rounded-md p-2.5">
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {appeal.reason}
            </p>
          </div>

          {appeal.reviewedBy && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Reviewed by {appeal.reviewedBy} {appeal.reviewedAt ? timeAgo(appeal.reviewedAt) : ''}
              {appeal.reviewNotes ? ` — ${appeal.reviewNotes}` : ''}
            </p>
          )}
        </div>

        {isPending && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              onClick={() => onReview(appeal.sessionId, 'approve')}
              disabled={isReviewing}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isReviewing ? '...' : 'Approve'}
            </button>
            <button
              onClick={() => onReview(appeal.sessionId, 'deny')}
              disabled={isReviewing}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isReviewing ? '...' : 'Deny'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function AppealsPanel({ authToken, apiBaseUrl }: AppealsPanelProps) {
  const [appeals, setAppeals] = useState<AppealEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const fetchAppeals = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const res = await fetch(`${apiBaseUrl}/admin/audit-log?type=appeal&limit=100`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAppeals(data.entries ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl]);

  useEffect(() => {
    fetchAppeals();
    const interval = setInterval(fetchAppeals, 30_000);
    return () => clearInterval(interval);
  }, [fetchAppeals]);

  // Re-render to update relative timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleReview = async (sessionId: string, action: 'approve' | 'deny') => {
    if (!authToken || !apiBaseUrl) return;
    setReviewing(sessionId);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/appeals/${sessionId}/review`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Refresh the list
      await fetchAppeals();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setReviewing(null);
    }
  };

  const pendingAppeals = appeals.filter((a) => a.status === 'pending');
  const reviewedAppeals = appeals.filter((a) => a.status !== 'pending');

  return (
    <Card className="border border-gray-200 dark:border-gray-700">
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
      ) : appeals.length === 0 ? (
        <EmptyState
          title="No appeals submitted"
          description="When users appeal killed sessions, they will appear here for review."
          icon={
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
              <path d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
          }
        />
      ) : (
        <div className="p-4 space-y-6">
          {/* Pending appeals first */}
          {pendingAppeals.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Pending ({pendingAppeals.length})
              </h3>
              <div className="space-y-3">
                {pendingAppeals.map((a) => (
                  <AppealCard
                    key={`${a.sessionId}-${a.createdAt}`}
                    appeal={a}
                    onReview={handleReview}
                    reviewing={reviewing}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Reviewed appeals */}
          {reviewedAppeals.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Reviewed ({reviewedAppeals.length})
              </h3>
              <div className="space-y-3">
                {reviewedAppeals.map((a) => (
                  <AppealCard
                    key={`${a.sessionId}-${a.createdAt}`}
                    appeal={a}
                    onReview={handleReview}
                    reviewing={reviewing}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
