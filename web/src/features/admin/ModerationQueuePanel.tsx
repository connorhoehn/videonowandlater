import { useState, useEffect, useCallback } from 'react';
import { Card, Badge, EmptyState, ConfirmModal, Skeleton } from '../../components/social';

interface FlagLabel {
  label: string;
  confidence: number;
}

interface ModerationItem {
  entryId: string;
  sessionId: string;
  sessionType: string;
  actionType: string;
  flagLabels?: FlagLabel[];
  timestamp: string;
  details?: string;
}

interface ModerationQueuePanelProps {
  authToken: string;
  apiBaseUrl: string;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncateId(id: string, len = 12): string {
  return id.length > len ? `${id.slice(0, len)}...` : id;
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <Card.Body>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton.Rect width="w-20" height="h-5" rounded="rounded-full" />
                <Skeleton.Line width="w-32" height="h-4" />
              </div>
              <Skeleton.Line width="w-full" height="h-4" />
              <Skeleton.Line width="w-3/4" height="h-3" />
              <div className="flex gap-2 pt-2">
                <Skeleton.Rect width="w-20" height="h-8" rounded="rounded-lg" />
                <Skeleton.Rect width="w-24" height="h-8" rounded="rounded-lg" />
              </div>
            </div>
          </Card.Body>
        </Card>
      ))}
    </div>
  );
}

export function ModerationQueuePanel({ authToken, apiBaseUrl }: ModerationQueuePanelProps) {
  const [items, setItems] = useState<ModerationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killTarget, setKillTarget] = useState<ModerationItem | null>(null);
  const [killing, setKilling] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const fetchFlags = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const res = await fetch(`${apiBaseUrl}/admin/audit-log?limit=50`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const entries: ModerationItem[] = (data.entries ?? []).filter(
        (e: ModerationItem) =>
          e.actionType === 'ML_FLAG' || e.actionType === 'ML_AUTO_KILL',
      );
      setItems(entries);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl]);

  useEffect(() => {
    fetchFlags();
    const interval = setInterval(fetchFlags, 15_000);
    return () => clearInterval(interval);
  }, [fetchFlags]);

  const [dismissError, setDismissError] = useState<string | null>(null);

  const handleDismiss = async (item: ModerationItem) => {
    // Optimistically remove from view
    setDismissed((prev) => new Set(prev).add(item.entryId));
    setDismissError(null);

    try {
      const res = await fetch(
        `${apiBaseUrl}/admin/moderation/${item.sessionId}/review`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'dismiss' }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err: unknown) {
      // Revert optimistic removal on failure
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(item.entryId);
        return next;
      });
      setDismissError(err instanceof Error ? err.message : 'Dismiss failed');
    }
  };

  const handleKill = async () => {
    if (!killTarget || !authToken || !apiBaseUrl) return;
    setKilling(true);
    try {
      const res = await fetch(
        `${apiBaseUrl}/admin/sessions/${killTarget.sessionId}/kill`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Killed from moderation queue' }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setKillTarget(null);
      setDismissed((prev) => new Set(prev).add(killTarget.entryId));
      fetchFlags();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Kill failed');
    } finally {
      setKilling(false);
    }
  };

  // Re-render every 30s to update relative times
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm">
        {error}
      </div>
    );
  }

  const visibleItems = items.filter((item) => !dismissed.has(item.entryId));

  if (visibleItems.length === 0) {
    return (
      <EmptyState
        title="No flagged content"
        description="The moderation queue is clear. Flagged sessions will appear here automatically."
      />
    );
  }

  return (
    <>
      {dismissError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm flex items-center justify-between">
          <span>{dismissError}</span>
          <button onClick={() => setDismissError(null)} className="text-red-400 hover:text-red-600 ml-2 cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleItems.map((item) => (
          <Card key={item.entryId}>
            <Card.Body>
              <div className="flex items-center gap-2 mb-2">
                <Badge
                  variant={item.sessionType === 'BROADCAST' ? 'primary' : 'info'}
                  size="sm"
                >
                  {item.sessionType || 'SESSION'}
                </Badge>
                <Badge
                  variant={item.actionType === 'ML_AUTO_KILL' ? 'danger' : 'warning'}
                  size="sm"
                >
                  {item.actionType === 'ML_AUTO_KILL' ? 'Auto-killed' : 'Flagged'}
                </Badge>
              </div>

              <p className="text-sm font-mono text-gray-700 dark:text-gray-300 mb-2">
                {truncateId(item.sessionId)}
              </p>

              {item.flagLabels && item.flagLabels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {item.flagLabels.map((fl) => (
                    <span
                      key={fl.label}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                    >
                      {fl.label}
                      <span className="opacity-60">{Math.round(fl.confidence)}%</span>
                    </span>
                  ))}
                </div>
              )}

              {item.details && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">
                  {item.details}
                </p>
              )}

              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                {formatRelativeTime(item.timestamp)}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => handleDismiss(item)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => setKillTarget(item)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
                >
                  Kill Session
                </button>
              </div>
            </Card.Body>
          </Card>
        ))}
      </div>

      <ConfirmModal
        isOpen={!!killTarget}
        onClose={() => setKillTarget(null)}
        onConfirm={handleKill}
        title="Kill Flagged Session"
        message={`Terminate session ${killTarget ? truncateId(killTarget.sessionId) : ''}? This will disconnect all participants and end the stream immediately.`}
        confirmLabel="Kill Session"
        variant="danger"
        loading={killing}
      />
    </>
  );
}
