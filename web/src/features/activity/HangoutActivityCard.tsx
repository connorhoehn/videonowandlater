/**
 * HangoutActivityCard - Activity card for hangout sessions
 * Displays userId, participant count, message count, duration, AI summary (2-line truncated), and relative timestamp
 */

import { useNavigate } from 'react-router-dom';
import { Card, Avatar } from '../../components/social';
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
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function HangoutActivityCard({ session }: HangoutActivityCardProps) {
  const navigate = useNavigate();
  const timestamp = formatDate(session.endedAt || session.createdAt);
  const duration = session.recordingDuration
    ? formatHumanDuration(session.recordingDuration)
    : null;
  const participantCount = session.participantCount || 0;
  const messageCount = session.messageCount || 0;

  const isReady = session.recordingStatus === 'available';

  return (
    <Card
      className={`group transition-all duration-300 ${isReady ? 'hover:shadow-lg cursor-pointer' : 'cursor-default'}`}
      onClick={isReady ? () => navigate(`/replay/${session.sessionId}`) : undefined}
    >
      {/* Hangout header band */}
      <div className="relative bg-gradient-to-r from-violet-500 to-purple-600 px-4 sm:px-5 py-3 flex items-center gap-3">
        <Avatar name={session.userId} alt={session.userId || 'Host'} size="sm" className="ring-2 ring-white/30" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate text-[15px]">{session.userId}</h3>
          <p className="text-xs text-white/70 mt-0.5 flex items-center gap-1.5">
            <span>{participantCount} participant{participantCount !== 1 ? 's' : ''}</span>
            <span className="text-white/40">&middot;</span>
            <span>{messageCount} msg{messageCount !== 1 ? 's' : ''}</span>
            {duration && (
              <>
                <span className="text-white/40">&middot;</span>
                <span>{duration}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PipelineStatusBadge session={session} />
          <span className="text-[11px] text-white/50">{timestamp}</span>
        </div>
        {!isReady && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 rounded-t-lg">
            <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-white text-sm font-medium">Processing recording...</span>
          </div>
        )}
      </div>

      {/* Card content */}
      <Card.Body>
        {/* AI Summary (Phase 20) */}
        <SummaryDisplay
          summary={session.aiSummary}
          status={session.aiSummaryStatus}
          visualAnalysis={session.visualAnalysis}
          truncate={true}
          className="text-gray-700 dark:text-gray-300"
        />

        {/* Audit Log - Processing Timeline */}
        <SessionAuditLog session={session} compact={true} />
      </Card.Body>
    </Card>
  );
}
