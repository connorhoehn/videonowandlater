import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Card } from '../../components/social/Card';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { EmptyState } from '../../components/social/EmptyState';
import { UserCostPanel } from './UserCostPanel';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CostData {
  totalCostUsd: number;
  byService: Record<string, number>;
  bySessionType: Record<string, number>;
  period: string;
  date: string;
  sessionCount?: number;
}

interface CostSummaryPanelProps {
  authToken: string;
  apiBaseUrl: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type PeriodKey = 'today' | 'week' | 'month';

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

const SERVICE_LABELS: Record<string, string> = {
  IVS_REALTIME: 'IVS Real-Time',
  IVS_LOW_LATENCY: 'IVS Broadcast',
  MEDIACONVERT: 'MediaConvert',
  TRANSCRIBE: 'Transcribe',
  BEDROCK_SONNET: 'Bedrock Sonnet',
  BEDROCK_NOVA: 'Bedrock Nova',
  S3: 'S3 Storage',
  CLOUDFRONT: 'CloudFront',
  POLLY_TTS: 'Amazon Polly',
  ECS_FARGATE: 'ECS Agent',
  TRANSCRIBE_STREAMING: 'Transcribe Stream',
};

const SERVICE_COLORS: Record<string, string> = {
  IVS_REALTIME: 'bg-blue-500',
  IVS_LOW_LATENCY: 'bg-sky-500',
  MEDIACONVERT: 'bg-purple-500',
  TRANSCRIBE: 'bg-green-500',
  BEDROCK_SONNET: 'bg-orange-500',
  BEDROCK_NOVA: 'bg-amber-500',
  S3: 'bg-gray-500',
  CLOUDFRONT: 'bg-teal-500',
  POLLY_TTS: 'bg-pink-500',
  ECS_FARGATE: 'bg-indigo-500',
  TRANSCRIBE_STREAMING: 'bg-emerald-500',
};

const SERVICE_HEX_COLORS: Record<string, string> = {
  IVS_REALTIME: '#3b82f6',
  IVS_LOW_LATENCY: '#0ea5e9',
  MEDIACONVERT: '#a855f7',
  TRANSCRIBE: '#22c55e',
  BEDROCK_SONNET: '#f97316',
  BEDROCK_NOVA: '#f59e0b',
  S3: '#6b7280',
  CLOUDFRONT: '#14b8a6',
  POLLY_TTS: '#ec4899',
  ECS_FARGATE: '#6366f1',
  TRANSCRIBE_STREAMING: '#10b981',
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

function dateRangeForPeriod(period: PeriodKey): { apiPeriod: string; date: string } {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  switch (period) {
    case 'today':
      return { apiPeriod: 'daily', date: today };
    case 'week': {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      return { apiPeriod: 'weekly', date: weekStart.toISOString().split('T')[0] };
    }
    case 'month':
      return { apiPeriod: 'monthly', date: today };
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CostSummaryPanel({ authToken, apiBaseUrl }: CostSummaryPanelProps) {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('today');

  const fetchCosts = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    setLoading(true);
    try {
      const { apiPeriod, date } = dateRangeForPeriod(period);
      const res = await fetch(
        `${apiBaseUrl}/admin/costs/summary?period=${apiPeriod}&date=${date}`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl, period]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  /* Derived data */
  const serviceEntries = useMemo(
    () =>
      data
        ? Object.entries(data.byService)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
        : [],
    [data],
  );

  const typeEntries = useMemo(
    () =>
      data
        ? Object.entries(data.bySessionType)
            .filter(([, v]) => v > 0)
            .sort((a, b) => b[1] - a[1])
        : [],
    [data],
  );

  const maxServiceCost = useMemo(
    () => (serviceEntries.length ? Math.max(...serviceEntries.map(([, v]) => v)) : 0),
    [serviceEntries],
  );

  const sessionCount = data?.sessionCount ?? typeEntries.reduce((sum, [, v]) => sum + v, 0);
  const totalCost = data?.totalCostUsd ?? 0;
  const avgCost = sessionCount > 0 ? totalCost / sessionCount : 0;
  const typeTotal = typeEntries.reduce((s, [, v]) => s + v, 0);

  const chartData = useMemo(
    () =>
      serviceEntries.map(([key, value]) => ({
        name: SERVICE_LABELS[key] ?? key,
        cost: value,
        color: SERVICE_HEX_COLORS[key] ?? '#6b7280',
      })),
    [serviceEntries],
  );

  /* ---- Error state ---- */
  if (error) {
    return (
      <div className="px-4 py-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-500/30 rounded-lg text-red-600 dark:text-red-400 text-sm">
        {error}
      </div>
    );
  }

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div className="space-y-6">
        {/* Period selector skeleton */}
        <div className="flex gap-2">
          {PERIOD_OPTIONS.map((o) => (
            <LoadingSkeleton key={o.key} variant="text" width="80px" height="36px" />
          ))}
        </div>
        {/* Summary cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <LoadingSkeleton variant="card" height="110px" />
          <LoadingSkeleton variant="card" height="110px" />
          <LoadingSkeleton variant="card" height="110px" />
        </div>
        {/* Chart skeleton */}
        <LoadingSkeleton variant="card" height="220px" />
        {/* Session type skeleton */}
        <LoadingSkeleton variant="card" height="120px" />
      </div>
    );
  }

  /* ---- Empty / zero state ---- */
  if (!data || totalCost === 0) {
    return (
      <div className="space-y-6">
        <PeriodSelector period={period} onChange={setPeriod} />
        <Card className="border border-gray-200 dark:border-gray-700">
          <Card.Body>
            <EmptyState
              title="No cost data for this period"
              description="Cost data will appear here once sessions are processed."
              variant="compact"
            />
          </Card.Body>
        </Card>
      </div>
    );
  }

  /* ---- Main render ---- */
  return (
    <div className="space-y-6">
      {/* 1. Period selector */}
      <PeriodSelector period={period} onChange={setPeriod} />

      {/* 2. Summary cards row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard label="Total Cost" value={formatCost(totalCost)} colorClass={costColor(totalCost)} />
        <SummaryCard label="Sessions Processed" value={String(sessionCount)} colorClass="text-white dark:text-white" />
        <SummaryCard label="Avg Cost / Session" value={formatCost(avgCost)} colorClass={costColor(avgCost)} />
      </div>

      {/* 3. Cost by Service */}
      <Card className="border border-gray-200 dark:border-gray-700">
        <Card.Header className="dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Cost by Service</h3>
        </Card.Header>
        <Card.Body className="pb-4">
          {serviceEntries.length === 0 ? (
            <p className="text-gray-400 text-sm">No service costs recorded</p>
          ) : (
            <>
              {/* Recharts horizontal bar */}
              <div className="w-full h-[200px] mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatCost(v)}
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fill: '#d1d5db', fontSize: 12 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatCost(value), 'Cost']}
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        color: '#f3f4f6',
                        fontSize: 13,
                      }}
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    />
                    <Bar dataKey="cost" radius={[0, 4, 4, 0]} barSize={20}>
                      {chartData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Fallback progress bars with labels */}
              <div className="space-y-2">
                {serviceEntries.map(([service, cost]) => {
                  const pct = maxServiceCost > 0 ? (cost / maxServiceCost) * 100 : 0;
                  const barColor = SERVICE_COLORS[service] ?? 'bg-gray-500';
                  return (
                    <div key={service} className="flex items-center gap-3">
                      <span className="w-28 text-xs text-gray-500 dark:text-gray-400 truncate">
                        {SERVICE_LABELS[service] ?? service}
                      </span>
                      <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-20 text-right text-xs font-mono text-gray-600 dark:text-gray-300 tabular-nums">
                        {formatCost(cost)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card.Body>
      </Card>

      {/* 4. Cost by Session Type */}
      <Card className="border border-gray-200 dark:border-gray-700">
        <Card.Header className="dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Cost by Session Type</h3>
        </Card.Header>
        <Card.Body>
          {typeEntries.length === 0 ? (
            <p className="text-gray-400 text-sm">No session type data</p>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              {typeEntries.map(([type, cost]) => {
                const pct = typeTotal > 0 ? ((cost / typeTotal) * 100).toFixed(1) : '0.0';
                return (
                  <div key={type} className="text-center">
                    <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                      {type}
                    </p>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">
                      {formatCost(cost)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{pct}%</p>
                  </div>
                );
              })}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* 5. User Cost Lookup */}
      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-semibold text-gray-600 dark:text-gray-400">
          User Cost Lookup
        </summary>
        <div className="mt-3">
          <UserCostPanel authToken={authToken} apiBaseUrl={apiBaseUrl} />
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PeriodSelector({
  period,
  onChange,
}: {
  period: PeriodKey;
  onChange: (p: PeriodKey) => void;
}) {
  return (
    <div className="flex gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 cursor-pointer ${
            period === opt.key
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass: string;
}) {
  return (
    <Card className="border border-gray-200 dark:border-gray-700">
      <Card.Body className="text-center py-5">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
          {label}
        </p>
        <p className={`text-3xl font-bold tabular-nums ${colorClass}`}>{value}</p>
      </Card.Body>
    </Card>
  );
}
