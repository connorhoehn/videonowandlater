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

  const isLive = session.status === 'live';
  const isReady = isLive || session.recordingStatus === 'available';

  return (
    <Card
      className={`group transition-all duration-300 ${isReady ? 'hover:shadow-lg cursor-pointer' : 'cursor-default'} ${isLive ? 'ring-2 ring-purple-500/50' : ''}`}
      onClick={isReady ? () => navigate(isLive ? `/hangout/${session.sessionId}` : `/replay/${session.sessionId}`) : undefined}
    >
      {/* Hangout header band */}
      <div className="relative bg-gradient-to-r from-violet-500 to-purple-600 px-4 sm:px-5 py-3 flex items-center gap-3">
        {isLive && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-purple-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-lg shadow-purple-600/30">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            LIVE
          </div>
        )}
        {session.isPinned && (
          <div className="absolute top-3 right-3 z-10 bg-amber-500/90 text-white p-1.5 rounded-full">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.789l1.599.8L9 4.323V3a1 1 0 011-1z" />
            </svg>
          </div>
        )}
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
        {!isReady && !isLive && (
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

        {/* Join Hangout CTA */}
        {isLive && (
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/hangout/${session.sessionId}`); }}
            className="mt-2 w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Join Hangout ({participantCount} {participantCount === 1 ? 'person' : 'people'})
          </button>
        )}

        {/* Audit Log - Processing Timeline */}
        <SessionAuditLog session={session} compact={true} />
      </Card.Body>
    </Card>
  );
}
