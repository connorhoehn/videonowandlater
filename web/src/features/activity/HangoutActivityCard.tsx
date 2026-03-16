/**
 * HangoutActivityCard - Activity card for hangout sessions
 * Displays userId, participant count, message count, duration, AI summary (2-line truncated), and relative timestamp
 */

import { useNavigate } from 'react-router-dom';
import { PipelineStatusBadge } from './PipelineStatusBadge';
import { formatHumanDuration } from './BroadcastActivityCard';
import { SessionAuditLog } from './SessionAuditLog';
import { SummaryDisplay } from '../replay/SummaryDisplay';
import type { ActivitySession } from './RecordingSlider';

interface HangoutActivityCardProps {
  session: ActivitySession;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function HangoutActivityCard({ session }: HangoutActivityCardProps) {
  const navigate = useNavigate();
  const timestamp = formatDate(session.endedAt || session.createdAt);
  const duration = session.recordingDuration
    ? formatHumanDuration(session.recordingDuration)
    : 'unknown';
  const participantCount = session.participantCount || 0;
  const messageCount = session.messageCount || 0;

  return (
    <div
      onClick={() => navigate(`/replay/${session.sessionId}`)}
      className="p-4 bg-white rounded-lg border border-gray-100 hover:border-gray-300 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{session.userId}</h3>
            <PipelineStatusBadge session={session} />
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {participantCount} participant{participantCount !== 1 ? 's' : ''} •{' '}
            {messageCount} message{messageCount !== 1 ? 's' : ''} • {duration} •{' '}
            {timestamp}
          </p>
        </div>
      </div>

      {/* AI Summary (Phase 20) */}
      <div className="mt-2">
        <SummaryDisplay
          summary={session.aiSummary}
          status={session.aiSummaryStatus}
          truncate={true}
          className="text-gray-700"
        />
      </div>

      {/* Audit Log - Processing Timeline */}
      <SessionAuditLog session={session} compact={true} />
    </div>
  );
}
