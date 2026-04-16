import { useState, useCallback } from 'react';
import { Card } from '../../components/social/Card';
import { Badge } from '../../components/social/Badge';
import { EmptyState } from '../../components/social/EmptyState';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CostLineItem {
  service: string;
  costUsd: number;
  quantity: number;
  unit: string;
  timestamp: string;
}

interface UserCostData {
  userId: string;
  totalCostUsd: number;
  lineItems: CostLineItem[];
}

interface UserCostPanelProps {
  authToken: string;
  apiBaseUrl: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SERVICE_LABELS: Record<string, string> = {
  IVS_REALTIME: 'IVS Real-Time',
  IVS_LOW_LATENCY: 'IVS Broadcast',
  MEDIACONVERT: 'MediaConvert',
  TRANSCRIBE: 'Transcribe',
  BEDROCK_SONNET: 'Bedrock Sonnet',
  BEDROCK_NOVA: 'Bedrock Nova',
  S3: 'S3 Storage',
  CLOUDFRONT: 'CloudFront',
};

const SERVICE_BADGE_VARIANT: Record<string, 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'light'> = {
  IVS_REALTIME: 'primary',
  IVS_LOW_LATENCY: 'info',
  MEDIACONVERT: 'warning',
  TRANSCRIBE: 'success',
  BEDROCK_SONNET: 'danger',
  BEDROCK_NOVA: 'warning',
  S3: 'light',
  CLOUDFRONT: 'info',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

function costColor(usd: number): string {
  if (usd < 1) return 'text-green-400';
  if (usd < 10) return 'text-yellow-400';
  return 'text-red-400';
}

function relativeTime(timestamp: string): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function UserCostPanel({ authToken, apiBaseUrl }: UserCostPanelProps) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState<UserCostData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || !authToken || !apiBaseUrl) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const res = await fetch(
        `${apiBaseUrl}/admin/costs/user/${encodeURIComponent(trimmed)}`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query, authToken, apiBaseUrl]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
    },
    [handleSearch],
  );

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter userId or username..."
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={handleSearch}
          disabled={!query.trim() || loading}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          Search
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-500/30 rounded-lg text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          <LoadingSkeleton variant="card" height="80px" />
          <LoadingSkeleton variant="card" height="200px" />
        </div>
      )}

      {/* Results */}
      {!loading && searched && !error && data && (
        <div className="space-y-4">
          {/* Total cost header */}
          <Card className="border border-gray-200 dark:border-gray-700">
            <Card.Body className="text-center py-4">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                Total Cost for {data.userId}
              </p>
              <p className={`text-3xl font-bold tabular-nums ${costColor(data.totalCostUsd)}`}>
                {formatCost(data.totalCostUsd)}
              </p>
            </Card.Body>
          </Card>

          {/* Line items timeline */}
          {data.lineItems.length === 0 ? (
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Body>
                <EmptyState
                  title="No cost line items"
                  description="This user has no recorded cost events."
                  variant="compact"
                />
              </Card.Body>
            </Card>
          ) : (
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Header className="dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Cost Timeline
                </h3>
                <span className="text-xs text-gray-400">
                  {data.lineItems.length} item{data.lineItems.length !== 1 ? 's' : ''}
                </span>
              </Card.Header>
              <Card.Body className="p-0">
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {[...data.lineItems]
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                      >
                        <Badge
                          variant={SERVICE_BADGE_VARIANT[item.service] ?? 'light'}
                          size="sm"
                        >
                          {SERVICE_LABELS[item.service] ?? item.service}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {item.quantity} {item.unit}
                          </span>
                        </div>
                        <span className="text-sm font-mono font-semibold text-gray-900 dark:text-white tabular-nums">
                          {formatCost(item.costUsd)}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 w-16 text-right">
                          {relativeTime(item.timestamp)}
                        </span>
                      </div>
                    ))}
                </div>
              </Card.Body>
            </Card>
          )}
        </div>
      )}

      {/* Empty search result */}
      {!loading && searched && !error && !data && (
        <Card className="border border-gray-200 dark:border-gray-700">
          <Card.Body>
            <EmptyState
              title="No data found"
              description="No cost data found for this user."
              variant="compact"
            />
          </Card.Body>
        </Card>
      )}
    </div>
  );
}
