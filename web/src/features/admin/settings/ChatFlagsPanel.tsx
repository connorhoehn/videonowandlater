/**
 * ChatFlagsPanel — admin UI for the Bedrock Nova Lite chat-moderation queue.
 *
 * Lists pending flags from `GET /admin/chat-flags?status=pending` and lets the
 * admin approve (dismiss the flag) or reject (bounce the offending user via
 * `POST /admin/chat-flags/{sessionId}/{sk}/resolve`). Auto-refreshes every 10s
 * while the panel is mounted so new classifier hits appear without manual
 * reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchToken } from '../../../auth/fetchToken';
import { getConfig } from '../../../config/aws-config';
import { Card, EmptyState, SkeletonLine, useToast } from '../../../components/social';

interface ChatFlag {
  PK: string;
  SK: string;
  sessionId: string;
  userId: string;
  messageId: string;
  text: string;
  categories: string[];
  confidence: number;
  reasoning: string;
  createdAt: string;
  status: 'pending' | 'resolved';
}

const REFRESH_INTERVAL_MS = 10_000;

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function ConfidencePill({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const cls =
    confidence >= 0.9
      ? 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300'
      : confidence >= 0.75
        ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300'
        : 'bg-gray-100 dark:bg-gray-500/20 text-gray-800 dark:text-gray-300';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>{pct}%</span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-3 border border-gray-200 dark:border-gray-700 rounded-lg space-y-2">
          <SkeletonLine width="w-1/3" height="h-4" />
          <SkeletonLine width="w-full" height="h-3" />
          <SkeletonLine width="w-2/3" height="h-3" />
        </div>
      ))}
    </div>
  );
}

export function ChatFlagsPanel() {
  const { addToast } = useToast();
  const apiBaseUrl = getConfig()?.apiUrl ?? '';
  const [authToken, setAuthToken] = useState<string>('');
  const [flags, setFlags] = useState<ChatFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvingSk, setResolvingSk] = useState<string | null>(null);

  // Keep a ref to the load fn so the setInterval callback always has the
  // latest closure (authToken may resolve after mount).
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    fetchToken()
      .then(({ token }) => setAuthToken(token ?? ''))
      .catch(() => setAuthToken(''));
  }, []);

  const load = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const res = await fetch(`${apiBaseUrl}/admin/chat-flags?status=pending`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setFlags(data.flags ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? String(err));
      if (flags === null) setFlags([]);
    }
  }, [apiBaseUrl, authToken, flags]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!authToken) return;
    const id = window.setInterval(() => loadRef.current(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [authToken]);

  const handleResolve = async (flag: ChatFlag, action: 'approve' | 'reject') => {
    if (!authToken) return;
    const label = action === 'approve' ? 'Approve (dismiss)' : 'Reject (bounce user)';
    if (!window.confirm(`${label} flag for ${flag.userId}?`)) return;

    setResolvingSk(flag.SK);
    try {
      const res = await fetch(
        `${apiBaseUrl}/admin/chat-flags/${encodeURIComponent(flag.sessionId)}/${encodeURIComponent(flag.SK)}/resolve`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      addToast({
        variant: 'success',
        title: action === 'approve' ? 'Flag dismissed' : 'User bounced',
        description: flag.userId,
      });
      // Optimistic remove from list + background refresh.
      setFlags((prev) => (prev ? prev.filter((f) => f.SK !== flag.SK) : prev));
      load();
    } catch (err: any) {
      addToast({
        variant: 'error',
        title: 'Failed to resolve flag',
        description: err.message ?? String(err),
      });
    } finally {
      setResolvingSk(null);
    }
  };

  return (
    <Card className="border border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            Chat moderation queue
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Bedrock Nova Lite classifier hits awaiting review. Auto-refreshes every 10s.
          </p>
        </div>
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

      {flags === null ? (
        <LoadingSkeleton />
      ) : flags.length === 0 ? (
        <EmptyState
          title="No pending chat flags"
          description="Messages flagged by the Nova Lite classifier will appear here for review."
        />
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {flags.map((flag) => (
            <li key={flag.SK} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-mono">user:{flag.userId}</span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <span className="font-mono">session:{flag.sessionId}</span>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <ConfidencePill confidence={flag.confidence} />
                    {flag.categories.map((c) => (
                      <span
                        key={c}
                        className="px-2 py-0.5 rounded-full text-[10px] bg-blue-50 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-sm text-gray-900 dark:text-white break-words">
                    “{flag.text}”
                  </p>
                  {flag.reasoning && (
                    <p className="mt-1 text-xs italic text-gray-500 dark:text-gray-400">
                      {flag.reasoning}
                    </p>
                  )}
                  <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                    {formatDate(flag.createdAt)}
                  </p>
                </div>

                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleResolve(flag, 'approve')}
                    disabled={resolvingSk === flag.SK}
                    className="px-3 py-1 text-xs font-medium rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {resolvingSk === flag.SK ? '...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleResolve(flag, 'reject')}
                    disabled={resolvingSk === flag.SK}
                    className="px-3 py-1 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {resolvingSk === flag.SK ? '...' : 'Reject'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
