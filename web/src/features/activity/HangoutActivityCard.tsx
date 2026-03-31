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

  return (
    <div
      onClick={() => navigate(`/replay/${session.sessionId}`)}
      className="group bg-white rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-lg cursor-pointer transition-all duration-300 overflow-hidden"
    >
      {/* Hangout header band */}
      <div className="bg-gradient-to-r from-violet-500 to-purple-600 px-4 sm:px-5 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
          <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        </div>
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
      </div>

      {/* Card content */}
      <div className="p-4 sm:p-5">
        {/* AI Summary (Phase 20) */}
        <SummaryDisplay
          summary={session.aiSummary}
          status={session.aiSummaryStatus}
          truncate={true}
          className="text-gray-700"
        />

        {/* Audit Log - Processing Timeline */}
        <SessionAuditLog session={session} compact={true} />
      </div>
    </div>
  );
}
