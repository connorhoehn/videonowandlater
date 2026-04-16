import { useState, useEffect, useCallback } from 'react';
import { Card, Badge, Avatar, ConfirmModal, EmptyState, SkeletonLine, SkeletonCircle } from '../../components/social';
import { SessionDetailPanel } from './SessionDetailPanel';

interface ActiveSession {
  sessionId: string;
  userId: string;
  sessionType: string;
  status: string;
  createdAt: string;
  participantCount: number;
  messageCount: number;
}

interface ActiveSessionsPanelProps {
  authToken: string;
  apiBaseUrl: string;
}

function formatDuration(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const totalSec = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4">
          <SkeletonCircle size="w-8 h-8" />
          <div className="flex-1 space-y-2">
            <SkeletonLine width="w-1/3" height="h-3" />
            <SkeletonLine width="w-1/2" height="h-3" />
          </div>
          <SkeletonLine width="w-16" height="h-6" />
        </div>
      ))}
    </div>
  );
}

/* ---- Desktop table row ---- */
function SessionTableRow({
  session,
  onKill,
  onClick,
}: {
  session: ActiveSession;
  onKill: (s: ActiveSession) => void;
  onClick: (s: ActiveSession) => void;
}) {
  return (
    <tr
      className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
      onClick={() => onClick(session)}
    >
      <td className="py-3 px-4">
        <Badge variant={session.sessionType === 'BROADCAST' ? 'info' : 'primary'}>
          {session.sessionType}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Avatar alt={session.userId} name={session.userId} size="xs" isOnline />
          <span className="text-gray-700 dark:text-gray-300 text-sm font-medium truncate max-w-[140px]">
            {session.userId}
          </span>
        </div>
      </td>
      <td className="py-3 px-4">
        <Badge variant={session.status === 'live' ? 'success' : 'warning'} dot />
        <span className="ml-2 text-xs font-medium text-gray-600 dark:text-gray-400">
          {session.status.toUpperCase()}
        </span>
      </td>
      <td className="py-3 px-4 text-gray-600 dark:text-gray-300 text-sm tabular-nums font-mono">
        {formatDuration(session.createdAt)}
      </td>
      <td className="py-3 px-4 text-gray-600 dark:text-gray-300 text-sm text-center">
        {session.participantCount}
      </td>
      <td className="py-3 px-4 text-gray-600 dark:text-gray-300 text-sm text-center">
        {session.messageCount}
      </td>
      <td className="py-3 px-4">
        <button
          onClick={(e) => { e.stopPropagation(); onKill(session); }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer"
          title="Kill session"
        >
          <StopIcon />
          Kill
        </button>
      </td>
    </tr>
  );
}

/* ---- Mobile card ---- */
function SessionCard({
  session,
  onKill,
  onClick,
}: {
  session: ActiveSession;
  onKill: (s: ActiveSession) => void;
  onClick: (s: ActiveSession) => void;
}) {
  return (
    <div
      className="p-4 border-b border-gray-100 dark:border-gray-700/50 last:border-b-0 cursor-pointer"
      onClick={() => onClick(session)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Avatar alt={session.userId} name={session.userId} size="sm" isOnline />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {session.userId}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant={session.sessionType === 'BROADCAST' ? 'info' : 'primary'} size="sm">
                {session.sessionType}
              </Badge>
              <Badge variant={session.status === 'live' ? 'success' : 'warning'} size="sm">
                {session.status.toUpperCase()}
              </Badge>
            </div>
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onKill(session); }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors cursor-pointer"
          title="Kill session"
        >
          <StopIcon />
          Kill
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <span className="text-gray-400 dark:text-gray-500">Duration</span>
          <p className="text-gray-700 dark:text-gray-300 font-mono tabular-nums mt-0.5">
            {formatDuration(session.createdAt)}
          </p>
        </div>
        <div>
          <span className="text-gray-400 dark:text-gray-500">Participants</span>
          <p className="text-gray-700 dark:text-gray-300 mt-0.5">{session.participantCount}</p>
        </div>
        <div>
          <span className="text-gray-400 dark:text-gray-500">Messages</span>
          <p className="text-gray-700 dark:text-gray-300 mt-0.5">{session.messageCount}</p>
        </div>
      </div>
    </div>
  );
}

export function ActiveSessionsPanel({ authToken, apiBaseUrl }: ActiveSessionsPanelProps) {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killTarget, setKillTarget] = useState<ActiveSession | null>(null);
  const [killing, setKilling] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!authToken || !apiBaseUrl) return;
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sessions`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10_000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleKill = async () => {
    if (!killTarget || !authToken || !apiBaseUrl) return;
    setKilling(true);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sessions/${killTarget.sessionId}/kill`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Killed from admin dashboard' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setKillTarget(null);
      fetchSessions();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setKilling(false);
    }
  };

  // Re-render every second to update durations
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

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
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No active sessions"
          description="Sessions will appear here when users start broadcasting or hanging out."
          icon={
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-3 px-4 font-medium text-xs uppercase tracking-wider">Type</th>
                  <th className="py-3 px-4 font-medium text-xs uppercase tracking-wider">User</th>
                  <th className="py-3 px-4 font-medium text-xs uppercase tracking-wider">Status</th>
                  <th className="py-3 px-4 font-medium text-xs uppercase tracking-wider">Duration</th>
                  <th className="py-3 px-4 font-medium text-xs uppercase tracking-wider text-center">Participants</th>
                  <th className="py-3 px-4 font-medium text-xs uppercase tracking-wider text-center">Messages</th>
                  <th className="py-3 px-4 font-medium text-xs uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <SessionTableRow key={s.sessionId} session={s} onKill={setKillTarget} onClick={(sess) => setSelectedSessionId(sess.sessionId)} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700/50">
            {sessions.map((s) => (
              <SessionCard key={s.sessionId} session={s} onKill={setKillTarget} onClick={(sess) => setSelectedSessionId(sess.sessionId)} />
            ))}
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={!!killTarget}
        onClose={() => setKillTarget(null)}
        onConfirm={handleKill}
        title="Kill Session"
        message={`Terminate session by ${killTarget?.userId}? This will disconnect all participants and end the stream.`}
        confirmLabel="Kill Session"
        variant="danger"
        loading={killing}
      />

      {selectedSessionId && (
        <SessionDetailPanel
          sessionId={selectedSessionId}
          isOpen={!!selectedSessionId}
          onClose={() => setSelectedSessionId(null)}
          authToken={authToken}
          apiBaseUrl={apiBaseUrl}
        />
      )}
    </Card>
  );
}
