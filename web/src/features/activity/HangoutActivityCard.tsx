/**
 * HangoutActivityCard - Activity card for hangout sessions
 * Displays userId, participant count, message count, duration, AI summary (2-line truncated), and relative timestamp
 */

import { useNavigate } from 'react-router-dom';
import { Card, Avatar } from '../../components/social';
import { PipelineStatusBadge } from './PipelineStatusBadge';
import { SessionAuditLog } from './SessionAuditLog';
import { SummaryDisplay } from '../replay/SummaryDisplay';
import { formatDate, formatHumanDuration, getSessionRoute } from './utils';
import { LiveBadge } from './LiveBadge';
import { PinBadge } from './PinBadge';
import { ProcessingOverlay } from './ProcessingOverlay';
import { LiveActionButton } from './LiveActionButton';
import type { ActivitySession } from './RecordingSlider';

interface HangoutActivityCardProps {
  session: ActivitySession;
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

  const route = getSessionRoute({ sessionId: session.sessionId, sessionType: session.sessionType, status: session.status });

  return (
    <Card
      className={`group transition-all duration-300 ${isReady ? 'hover:shadow-lg cursor-pointer' : 'cursor-default'} ${isLive ? 'ring-2 ring-purple-500/50' : ''}`}
      onClick={isReady ? () => navigate(route) : undefined}
    >
      {/* Hangout header band */}
      <div className="relative bg-gradient-to-r from-violet-500 to-purple-600 px-4 sm:px-5 py-3 flex items-center gap-3">
        {isLive && <LiveBadge variant="hangout" />}
        {session.isPinned && <PinBadge />}
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
        <ProcessingOverlay visible={!isReady && !isLive} message="Processing recording..." />
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
          <LiveActionButton sessionId={session.sessionId} sessionType="HANGOUT" participantCount={participantCount} />
        )}

        {/* Audit Log - Processing Timeline */}
        <SessionAuditLog session={session} compact={true} />
      </Card.Body>
    </Card>
  );
}
