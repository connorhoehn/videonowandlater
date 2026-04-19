/**
 * SurveysPanel — admin view over post-call NPS survey responses.
 *
 * Top: aggregate card (NPS score + promoter/passive/detractor percentages +
 * total response count). Filter: 7 / 30 / 90 days. Bottom: recent surveys
 * table with a click-through to drill into a single session's surveys.
 *
 * Endpoints:
 *   GET /admin/surveys?since=ISO
 *   GET /admin/sessions/{sessionId}/surveys
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchToken } from '../../../auth/fetchToken';
import { getConfig } from '../../../config/aws-config';
import { Card, EmptyState, SkeletonLine } from '../../../components/social';

interface Survey {
  PK: string;
  SK: string;
  sessionId: string;
  userId: string;
  nps: number;
  freeText?: string;
  submittedAt: string;
  sessionType?: string;
}

interface Aggregate {
  count: number;
  npsAvg: number;
  promoters: number;
  passives: number;
  detractors: number;
  npsScore: number;
}

type RangeDays = 7 | 30 | 90;

const RANGES: { key: RangeDays; label: string }[] = [
  { key: 7, label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function bucket(nps: number): 'promoter' | 'passive' | 'detractor' {
  if (nps >= 9) return 'promoter';
  if (nps >= 7) return 'passive';
  return 'detractor';
}

function BucketPill({ nps }: { nps: number }) {
  const b = bucket(nps);
  const cls =
    b === 'promoter'
      ? 'bg-green-100 dark:bg-green-500/20 text-green-800 dark:text-green-300'
      : b === 'passive'
        ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-800 dark:text-yellow-300'
        : 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>
      {nps} · {b}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
          <SkeletonLine width="w-1/3" height="h-4" />
          <SkeletonLine width="w-full" height="h-3" />
        </div>
      ))}
    </div>
  );
}

interface SessionDrilldownProps {
  sessionId: string;
  authToken: string;
  apiBaseUrl: string;
  onBack: () => void;
}

function SessionDrilldown({ sessionId, authToken, apiBaseUrl, onBack }: SessionDrilldownProps) {
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${apiBaseUrl}/admin/sessions/${encodeURIComponent(sessionId)}/surveys`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSurveys(data.surveys ?? []);
          setAggregate(data.aggregate ?? null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, authToken, sessionId]);

  return (
    <Card className="border border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <button
            onClick={onBack}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mb-1 cursor-pointer"
          >
            ← All surveys
          </button>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white font-mono">
            Session {sessionId}
          </h3>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-4 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {aggregate && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 grid grid-cols-4 gap-4 text-center">
          <Stat label="NPS" value={aggregate.npsScore} />
          <Stat label="Promoters" value={aggregate.promoters} />
          <Stat label="Passives" value={aggregate.passives} />
          <Stat label="Detractors" value={aggregate.detractors} />
        </div>
      )}

      {surveys === null ? (
        <LoadingSkeleton />
      ) : surveys.length === 0 ? (
        <EmptyState title="No surveys for this session" description="" />
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {surveys.map((s) => (
            <li key={s.SK} className="p-4 space-y-1">
              <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400">
                <span className="font-mono">user:{s.userId}</span>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <BucketPill nps={s.nps} />
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span>{formatDate(s.submittedAt)}</span>
              </div>
              {s.freeText && (
                <p className="text-sm text-gray-900 dark:text-white break-words">"{s.freeText}"</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </div>
    </div>
  );
}

export function SurveysPanel() {
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [authToken, setAuthToken] = useState<string>('');
  const [range, setRange] = useState<RangeDays>(30);
  const [surveys, setSurveys] = useState<Survey[] | null>(null);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);

  useEffect(() => {
    fetchToken()
      .then(({ token }) => setAuthToken(token ?? ''))
      .catch(() => setAuthToken(''));
  }, []);

  const sinceIso = useMemo(
    () => new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString(),
    [range],
  );

  const load = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const res = await fetch(
        `${apiBaseUrl}/admin/surveys?since=${encodeURIComponent(sinceIso)}`,
        { headers: { Authorization: `Bearer ${authToken}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSurveys(data.surveys ?? []);
      setAggregate(data.aggregate ?? null);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? String(err));
      if (surveys === null) setSurveys([]);
    }
  }, [apiBaseUrl, authToken, sinceIso, surveys]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, sinceIso]);

  if (focusedSessionId) {
    return (
      <SessionDrilldown
        sessionId={focusedSessionId}
        authToken={authToken}
        apiBaseUrl={apiBaseUrl}
        onBack={() => setFocusedSessionId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Aggregate scorecard */}
      <Card className="border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Post-call surveys
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              NPS aggregate across all sessions in the selected window.
            </p>
          </div>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                  range === r.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {aggregate ? (
          <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <Stat label="NPS Score" value={aggregate.npsScore} />
            <Stat label="Responses" value={aggregate.count} />
            <Stat
              label="Promoters"
              value={
                aggregate.count > 0
                  ? `${Math.round((aggregate.promoters / aggregate.count) * 100)}%`
                  : '0%'
              }
            />
            <Stat
              label="Detractors"
              value={
                aggregate.count > 0
                  ? `${Math.round((aggregate.detractors / aggregate.count) * 100)}%`
                  : '0%'
              }
            />
          </div>
        ) : (
          <LoadingSkeleton />
        )}
      </Card>

      {/* Recent table */}
      <Card className="border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Recent responses</h4>
          <button
            onClick={load}
            className="text-xs px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-4 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {surveys === null ? (
          <LoadingSkeleton />
        ) : surveys.length === 0 ? (
          <EmptyState
            title="No surveys in this window"
            description="Surveys submitted by participants after sessions end will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-2 font-medium">Session</th>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">NPS</th>
                  <th className="px-4 py-2 font-medium">Comment</th>
                  <th className="px-4 py-2 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {surveys.map((s) => {
                  const snippet = s.freeText
                    ? s.freeText.length > 80
                      ? `${s.freeText.slice(0, 80)}…`
                      : s.freeText
                    : '';
                  return (
                    <tr
                      key={s.SK}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/60"
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        <button
                          onClick={() => setFocusedSessionId(s.sessionId)}
                          className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {s.sessionId}
                        </button>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">
                        {s.userId}
                      </td>
                      <td className="px-4 py-2">
                        <BucketPill nps={s.nps} />
                      </td>
                      <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{snippet}</td>
                      <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(s.submittedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
