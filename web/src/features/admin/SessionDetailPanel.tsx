import { useState, useEffect, useCallback } from 'react';
import { Card, Badge, Avatar, ConfirmModal } from '../../components/social';
import { OffcanvasSidebar } from '../../components/social/OffcanvasSidebar';
import { SessionEventLog } from './SessionEventLog';
import type { SessionEvent } from './SessionEventLog';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SessionDetail {
  sessionId: string;
  userId: string;
  sessionType: string;
  status: string;
  createdAt: string;
  endedAt?: string;
  participantCount?: number;
  messageCount?: number;
  channelArn?: string;
  stageArn?: string;
  claimedResources?: Record<string, string>;
}

interface CostSummary {
  totalCostUsd: number;
  breakdown?: Record<string, number>;
}

interface CostLineItem {
  service: string;
  costUsd: number;
  quantity?: number;
  unit?: string;
}

interface Participant {
  participantId: string;
  userId: string;
  joinedAt?: string;
  leftAt?: string;
}

interface ModerationRecord {
  actionType: string;
  actorId?: string;
  reason?: string;
  createdAt: string;
  reviewStatus?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewAction?: string;
}

interface ContextEventRecord {
  contextId: string;
  sessionId: string;
  sourceAppId: string;
  eventType: string;
  timestamp: number;
  metadata: {
    documentId?: string;
    documentTitle?: string;
    editSummary?: string;
    editCount?: number;
    userId?: string;
    [key: string]: any;
  };
  createdAt: string;
}

interface IntentFlowStep {
  stepId: string;
  prompt: string;
  intentSlot: string;
  slotType?: string;
  choices?: string[];
  required: boolean;
  filledValue?: string;
  filledAt?: string;
  confidence?: number;
}

interface IntentFlowRecord {
  flowId: string;
  sessionId: string;
  sourceAppId: string;
  name: string;
  steps: IntentFlowStep[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

interface IntentResultRecord {
  intentSlot: string;
  value: string;
  confidence: number;
  extractedAt: string;
}

interface SessionDetailData {
  session: SessionDetail;
  cost: {
    summary: CostSummary | null;
    lineItems: CostLineItem[];
  };
  participants: Participant[];
  moderationHistory: ModerationRecord[];
  contextEvents: ContextEventRecord[];
  intentFlow: IntentFlowRecord | null;
  intentResults: IntentResultRecord[];
  sessionEvents: SessionEvent[];
}

interface SessionDetailPanelProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
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

const ACTION_CONFIG: Record<string, { variant: 'danger' | 'warning' | 'info' | 'light'; label: string; dot: string }> = {
  ADMIN_KILL: { variant: 'danger', label: 'Admin Kill', dot: 'bg-red-500' },
  ML_FLAG: { variant: 'warning', label: 'ML Flag', dot: 'bg-yellow-500' },
  ML_AUTO_KILL: { variant: 'danger', label: 'Auto Kill', dot: 'bg-red-500' },
  ADMIN_REVIEW: { variant: 'info', label: 'Review', dot: 'bg-blue-500' },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

function formatDuration(createdAt: string, endedAt?: string): string {
  const start = new Date(createdAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffMs = end - start;
  const totalSec = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
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

function getActionConfig(action: string) {
  return ACTION_CONFIG[action] ?? { variant: 'light' as const, label: action, dot: 'bg-gray-400' };
}

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'light' {
  switch (status.toLowerCase()) {
    case 'live': return 'success';
    case 'ending': return 'warning';
    case 'ended': return 'danger';
    default: return 'light';
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function SessionDetailPanel({
  sessionId,
  isOpen,
  onClose,
  authToken,
  apiBaseUrl,
}: SessionDetailPanelProps) {
  const [data, setData] = useState<SessionDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [killTarget, setKillTarget] = useState(false);
  const [killing, setKilling] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!authToken || !apiBaseUrl || !sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sessions/${sessionId}/detail`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch session detail');
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl, sessionId]);

  useEffect(() => {
    if (isOpen && sessionId) {
      fetchDetail();
    } else {
      setData(null);
      setError(null);
    }
  }, [isOpen, sessionId, fetchDetail]);

  const handleKill = async () => {
    if (!authToken || !apiBaseUrl || !sessionId) return;
    setKilling(true);
    try {
      const res = await fetch(`${apiBaseUrl}/admin/sessions/${sessionId}/kill`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Killed from session detail panel' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setKillTarget(false);
      fetchDetail();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Kill failed');
    } finally {
      setKilling(false);
    }
  };

  const session = data?.session;
  const costSummary = data?.cost?.summary;
  const costLineItems = data?.cost?.lineItems ?? [];
  const participants = data?.participants ?? [];
  const moderationHistory = data?.moderationHistory ?? [];
  const contextEvents = data?.contextEvents ?? [];
  const intentFlow = data?.intentFlow ?? null;

  const isLiveOrEnding =
    session && (session.status.toLowerCase() === 'live' || session.status.toLowerCase() === 'ending');

  const breakdownEntries = costSummary?.breakdown
    ? Object.entries(costSummary.breakdown)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : [];
  const maxBreakdownCost = breakdownEntries.length
    ? Math.max(...breakdownEntries.map(([, v]) => v))
    : 0;

  return (
    <>
      <OffcanvasSidebar
        isOpen={isOpen}
        onClose={onClose}
        title="Session Detail"
        side="right"
        width="w-[420px]"
      >
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg text-red-700 dark:text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {!loading && !error && session && (
          <div className="space-y-4">
            {/* 1. Session Info */}
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Body>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant={session.sessionType === 'BROADCAST' ? 'info' : 'primary'}>
                    {session.sessionType}
                  </Badge>
                  <Badge variant={statusVariant(session.status)} dot>
                    {session.status.toUpperCase()}
                  </Badge>
                </div>

                <div className="flex items-center gap-2.5 mb-3">
                  <Avatar alt={session.userId} name={session.userId} size="sm" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {session.userId}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex justify-between">
                    <span>Created</span>
                    <span className="text-gray-700 dark:text-gray-300">{formatTimestamp(session.createdAt)}</span>
                  </div>
                  {session.endedAt && (
                    <div className="flex justify-between">
                      <span>Ended</span>
                      <span className="text-gray-700 dark:text-gray-300">{formatTimestamp(session.endedAt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Duration</span>
                    <span className="text-gray-700 dark:text-gray-300 font-mono tabular-nums">
                      {formatDuration(session.createdAt, session.endedAt)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Session ID</span>
                    <span className="text-gray-700 dark:text-gray-300 font-mono text-[11px]">
                      {session.sessionId.slice(0, 12)}...
                    </span>
                  </div>
                </div>
              </Card.Body>
            </Card>

            {/* 2. Cost Breakdown */}
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Header className="dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Cost Breakdown</h3>
              </Card.Header>
              <Card.Body>
                {costSummary ? (
                  <>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums mb-3">
                      {formatCost(costSummary.totalCostUsd)}
                    </p>
                    {breakdownEntries.length > 0 ? (
                      <div className="space-y-2">
                        {breakdownEntries.map(([service, cost]) => {
                          const pct = maxBreakdownCost > 0 ? (cost / maxBreakdownCost) * 100 : 0;
                          const barColor = SERVICE_COLORS[service] ?? 'bg-gray-500';
                          return (
                            <div key={service} className="flex items-center gap-2">
                              <span className="w-24 text-xs text-gray-500 dark:text-gray-400 truncate">
                                {SERVICE_LABELS[service] ?? service}
                              </span>
                              <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${barColor} transition-all duration-500`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="w-16 text-right text-xs font-mono text-gray-600 dark:text-gray-300 tabular-nums">
                                {formatCost(cost)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : costLineItems.length > 0 ? (
                      <div className="space-y-1.5">
                        {costLineItems.map((item, i) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="text-gray-500 dark:text-gray-400">
                              {SERVICE_LABELS[item.service] ?? item.service}
                            </span>
                            <span className="text-gray-700 dark:text-gray-300 font-mono tabular-nums">
                              {formatCost(item.costUsd)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500">No cost data available</p>
                )}
              </Card.Body>
            </Card>

            {/* 3. Participants */}
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Header className="dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Participants</h3>
                <span className="text-xs text-gray-400">{participants.length}</span>
              </Card.Header>
              <Card.Body>
                {participants.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {participants.map((p) => (
                      <div key={p.participantId} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-50 dark:bg-gray-800">
                        <Avatar alt={p.userId} name={p.userId} size="xs" />
                        <span className="text-xs text-gray-700 dark:text-gray-300">
                          {p.userId}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500">
                    {session.sessionType === 'BROADCAST' ? 'N/A (broadcast)' : 'No participants'}
                  </p>
                )}
              </Card.Body>
            </Card>

            {/* 4. Moderation History */}
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Header className="dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Moderation History</h3>
              </Card.Header>
              <Card.Body className="px-0 py-0">
                {moderationHistory.length > 0 ? (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                    {moderationHistory.map((record, i) => {
                      const config = getActionConfig(record.actionType);
                      return (
                        <div key={i} className="flex items-start gap-3 px-4 py-3">
                          <div className="mt-1.5 shrink-0">
                            <span className={`block w-2.5 h-2.5 rounded-full ${config.dot} ring-4 ring-white dark:ring-gray-800`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Badge variant={config.variant} size="sm">
                                {config.label}
                              </Badge>
                              {record.reviewStatus && (
                                <Badge variant={record.reviewStatus === 'dismissed' ? 'light' : 'info'} size="sm">
                                  {record.reviewStatus}
                                </Badge>
                              )}
                            </div>
                            {record.reason && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                                {record.reason}
                              </p>
                            )}
                            {record.actorId && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                by {record.actorId}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap tabular-nums shrink-0 mt-0.5">
                            {timeAgo(record.createdAt)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <p className="text-sm text-gray-400 dark:text-gray-500">No moderation actions</p>
                  </div>
                )}
              </Card.Body>
            </Card>

            {/* 5. Context Events */}
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Header className="dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Context Events</h3>
                <span className="text-xs text-gray-400">{contextEvents.length}</span>
              </Card.Header>
              <Card.Body className="px-0 py-0">
                {contextEvents.length > 0 ? (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                    {contextEvents.map((evt, i) => {
                      const isSwitch = evt.eventType === 'DOCUMENT_SWITCH';
                      const dotColor = isSwitch ? 'bg-amber-500' : 'bg-blue-500';
                      const badgeVariant = isSwitch ? 'warning' : 'info';
                      return (
                        <div key={i} className="flex items-start gap-3 px-4 py-3">
                          <div className="mt-1.5 shrink-0">
                            <span className={`block w-2.5 h-2.5 rounded-full ${dotColor} ring-4 ring-white dark:ring-gray-800`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <Badge variant={badgeVariant} size="sm">
                                {evt.eventType.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            {evt.metadata?.documentTitle && (
                              <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 truncate">
                                {evt.metadata.documentTitle}
                              </p>
                            )}
                            {evt.metadata?.editSummary && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                                {evt.metadata.editSummary}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap tabular-nums shrink-0 mt-0.5">
                            {timeAgo(evt.createdAt)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <p className="text-sm text-gray-400 dark:text-gray-500">No context events</p>
                  </div>
                )}
              </Card.Body>
            </Card>

            {/* 6. AI Agent */}
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Header className="dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">AI Agent</h3>
                {(session as any).agentStatus && (
                  <Badge
                    variant={
                      (session as any).agentStatus === 'completed' ? 'success'
                        : (session as any).agentStatus === 'failed' ? 'danger'
                        : (session as any).agentStatus === 'speaking' ? 'primary'
                        : 'info'
                    }
                    size="sm"
                  >
                    {(session as any).agentStatus}
                  </Badge>
                )}
              </Card.Header>
              <Card.Body>
                {intentFlow ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{intentFlow.name}</span>
                      <Badge
                        variant={
                          intentFlow.status === 'completed' ? 'success'
                            : intentFlow.status === 'failed' ? 'danger'
                            : intentFlow.status === 'in_progress' ? 'info'
                            : 'light'
                        }
                        size="sm"
                      >
                        {intentFlow.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>

                    {/* Progress bar */}
                    {intentFlow.steps.length > 0 && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>Progress</span>
                          <span>
                            {intentFlow.steps.filter((s) => s.filledValue).length} / {intentFlow.steps.length} slots
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-500"
                            style={{
                              width: `${(intentFlow.steps.filter((s) => s.filledValue).length / intentFlow.steps.length) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Slot table */}
                    <div className="space-y-1">
                      {intentFlow.steps.map((step) => {
                        const filled = !!step.filledValue;
                        return (
                          <div
                            key={step.stepId}
                            className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${
                              filled
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                            }`}
                          >
                            <span className="font-medium">{step.intentSlot}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono truncate max-w-[120px]">
                                {step.filledValue ?? '--'}
                              </span>
                              {step.confidence != null && (
                                <span
                                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                                    step.confidence > 0.8
                                      ? 'bg-green-100 text-green-700 dark:bg-green-800/40 dark:text-green-400'
                                      : step.confidence >= 0.5
                                      ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-800/40 dark:text-yellow-400'
                                      : 'bg-red-100 text-red-700 dark:bg-red-800/40 dark:text-red-400'
                                  }`}
                                >
                                  {(step.confidence * 100).toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 dark:text-gray-500">No AI agent or intent flow for this session</p>
                )}
              </Card.Body>
            </Card>

            {/* 7. Event Log */}
            <Card className="border border-gray-200 dark:border-gray-700">
              <Card.Header className="dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Event Log</h3>
                <span className="text-xs text-gray-400">{(data?.sessionEvents ?? []).length}</span>
              </Card.Header>
              <Card.Body className="px-0 py-0">
                <SessionEventLog events={data?.sessionEvents ?? []} />
              </Card.Body>
            </Card>

            {/* 8. Actions */}
            {isLiveOrEnding && (
              <div className="pt-2">
                <button
                  onClick={() => setKillTarget(true)}
                  className="w-full px-4 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
                >
                  Kill Session
                </button>
              </div>
            )}
          </div>
        )}
      </OffcanvasSidebar>

      <ConfirmModal
        isOpen={killTarget}
        onClose={() => setKillTarget(false)}
        onConfirm={handleKill}
        title="Kill Session"
        message={`Terminate session ${session?.userId ? `by ${session.userId}` : sessionId}? This will disconnect all participants and end the stream.`}
        confirmLabel="Kill Session"
        variant="danger"
        loading={killing}
      />
    </>
  );
}
