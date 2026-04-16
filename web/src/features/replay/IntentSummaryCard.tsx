import { useState, useEffect, useCallback } from 'react';
import { Card, Badge } from '../../components/social';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

interface IntentFlow {
  flowId: string;
  sessionId: string;
  sourceAppId: string;
  name: string;
  steps: IntentFlowStep[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

interface IntentSummaryCardProps {
  sessionId: string;
  authToken: string;
  apiBaseUrl: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function confidenceColor(confidence: number): string {
  if (confidence > 0.8) return 'bg-green-100 text-green-700 dark:bg-green-800/40 dark:text-green-400';
  if (confidence >= 0.5) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-800/40 dark:text-yellow-400';
  return 'bg-red-100 text-red-700 dark:bg-red-800/40 dark:text-red-400';
}

function statusVariant(status: IntentFlow['status']): 'success' | 'danger' | 'info' | 'light' {
  switch (status) {
    case 'completed': return 'success';
    case 'failed': return 'danger';
    case 'in_progress': return 'info';
    default: return 'light';
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function IntentSummaryCard({ sessionId, authToken, apiBaseUrl }: IntentSummaryCardProps) {
  const [flow, setFlow] = useState<IntentFlow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchFlow = useCallback(async () => {
    if (!authToken || !apiBaseUrl || !sessionId) return;
    try {
      const res = await fetch(`${apiBaseUrl}/sessions/${sessionId}/intent-flow`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) {
        setFlow(null);
        return;
      }
      const data = await res.json();
      setFlow(data.flow ?? data ?? null);
    } catch {
      setFlow(null);
    } finally {
      setLoading(false);
    }
  }, [authToken, apiBaseUrl, sessionId]);

  useEffect(() => {
    fetchFlow();
  }, [fetchFlow]);

  // Loading skeleton
  if (loading) {
    return (
      <Card className="border border-gray-200 dark:border-gray-700 animate-pulse">
        <Card.Body>
          <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-3" />
          <div className="space-y-2">
            <div className="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="h-3 w-3/4 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </Card.Body>
      </Card>
    );
  }

  // Don't render if no flow
  if (!flow) return null;

  const filledCount = flow.steps.filter((s) => s.filledValue).length;

  return (
    <Card className="border border-gray-200 dark:border-gray-700">
      <Card.Header className="dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Intent Flow</h3>
          <Badge variant={statusVariant(flow.status)} size="sm">
            {flow.status.replace(/_/g, ' ')}
          </Badge>
        </div>
      </Card.Header>
      <Card.Body>
        <p className="text-sm font-medium text-gray-900 dark:text-white mb-3">{flow.name}</p>

        {/* Progress */}
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Slots filled</span>
          <span>{filledCount} / {flow.steps.length}</span>
        </div>
        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${flow.steps.length > 0 ? (filledCount / flow.steps.length) * 100 : 0}%` }}
          />
        </div>

        {/* Slot rows */}
        <div className="space-y-1">
          {flow.steps.map((step) => (
            <div
              key={step.stepId}
              className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-800"
            >
              <span className="font-medium text-gray-700 dark:text-gray-300">{step.intentSlot}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-gray-600 dark:text-gray-400 truncate max-w-[140px]">
                  {step.filledValue ?? '--'}
                </span>
                {step.confidence != null && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${confidenceColor(step.confidence)}`}>
                    {(step.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
}
