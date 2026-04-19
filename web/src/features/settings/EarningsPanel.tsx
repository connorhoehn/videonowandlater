/**
 * EarningsPanel — creator-facing payout history, backed by GET /me/earnings
 * (passthrough to vnl-ads GET /v1/creators/{userId}/payouts). Reads auth from
 * the existing Cognito session.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchToken } from '../../auth/fetchToken';
import { getConfig } from '../../config/aws-config';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

// vnl-ads v0.4 payout shape
type PayoutStatus = 'PENDING' | 'PAID' | 'PROCESSING' | 'VOID' | string;

interface PayoutItem {
  id: string;
  campaignId: string;
  campaignName: string | null;
  periodStart: string;
  periodEnd: string;
  impressions: number;
  clicks: number;
  grossCents: number;
  revsharePct: string;
  payoutCents: number;
  status: PayoutStatus;
}

interface EarningsResponse {
  creatorId: string;
  totalCents: number;
  items: PayoutItem[];
}

interface SeriesPoint {
  bucket: string;
  impressions: number;
  clicks: number;
}

interface SeriesResponse {
  creatorId: string;
  from: string;
  to: string;
  granularity: 'hour' | 'day';
  points: SeriesPoint[];
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export function EarningsPanel() {
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { token } = await fetchToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [earningsRes, seriesRes] = await Promise.all([
        fetch(`${apiBaseUrl}/me/earnings`, { headers }),
        fetch(`${apiBaseUrl}/me/impression-series?granularity=day`, { headers }),
      ]);
      if (!earningsRes.ok) throw new Error(`${earningsRes.status}`);
      setData((await earningsRes.json()) as EarningsResponse);
      if (seriesRes.ok) {
        setSeries((await seriesRes.json()) as SeriesResponse);
      } else {
        setSeries({
          creatorId: '',
          from: new Date(0).toISOString(),
          to: new Date(0).toISOString(),
          granularity: 'day',
          points: [],
        });
      }
    } catch (e: any) {
      setErr(`Failed to load earnings: ${e.message}`);
      setData(null);
      setSeries(null);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => { load(); }, [load]);

  const payouts = data?.items ?? [];
  const totalPayoutCents = data?.totalCents ?? 0;
  const totalGrossCents = useMemo(
    () => payouts.reduce((sum, p) => sum + (p.grossCents ?? 0), 0),
    [payouts],
  );
  const totalImpressions = useMemo(
    () => payouts.reduce((sum, p) => sum + (p.impressions ?? 0), 0),
    [payouts],
  );
  const totalClicks = useMemo(
    () => payouts.reduce((sum, p) => sum + (p.clicks ?? 0), 0),
    [payouts],
  );
  const ctr = useMemo(() => {
    if (totalImpressions === 0) return null;
    return (totalClicks / totalImpressions) * 100;
  }, [totalImpressions, totalClicks]);

  return (
    <section className="space-y-4">
      <header className="mb-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Earnings</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Revenue share from sponsored content shown during your sessions.
        </p>
      </header>

      {err && (
        <div className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-2">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Total paid" value={loading ? '…' : centsToUsd(totalPayoutCents)} />
        <Card label="Total gross" value={loading ? '…' : centsToUsd(totalGrossCents)} />
        <Card label="Impressions" value={loading ? '…' : totalImpressions.toLocaleString()} />
        <Card label="CTR" value={loading ? '…' : ctr !== null ? `${ctr.toFixed(2)}%` : '—'} />
      </div>

      {series && series.points.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            Impressions (last 30 days)
          </h3>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={series.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(5, 10)}
                />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
                />
                <Line type="monotone" dataKey="impressions" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="clicks" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Payout history</h3>
        </div>
        {loading ? (
          <p className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : payouts.length === 0 ? (
          <p className="p-4 text-sm text-gray-500 dark:text-gray-400">No payouts yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
              <tr>
                <th className="text-left px-4 py-2">Campaign / Period</th>
                <th className="text-right px-4 py-2">Impressions</th>
                <th className="text-right px-4 py-2">Clicks</th>
                <th className="text-right px-4 py-2">Payout</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-gray-900 dark:text-white">
                    {p.campaignName ?? '—'}
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right">{p.impressions.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">{p.clicks.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-medium">{centsToUsd(p.payoutCents)}</td>
                  <td className="px-4 py-2">
                    <StatusPill status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
      <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-900 dark:text-white mt-1">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: PayoutStatus }) {
  const up = (status ?? '').toUpperCase();
  const styles: Record<string, string> = {
    PAID: 'bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/30',
    PENDING: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
    PROCESSING: 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30',
    VOID: 'bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-600/50',
  };
  const cls = styles[up] ?? styles.PENDING;
  return (
    <span className={`inline-flex text-[11px] uppercase tracking-wider px-2 py-0.5 rounded border font-medium ${cls}`}>
      {up || '—'}
    </span>
  );
}
