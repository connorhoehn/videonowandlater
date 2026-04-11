/**
 * BroadcastActivityCard - Activity card for broadcast sessions
 * Displays userId, duration, reaction summary pills, AI summary (2-line truncated), and relative timestamp
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Avatar } from '../../components/social';
import { ReactionSummaryPills } from './ReactionSummaryPills';
import { PipelineStatusBadge } from './PipelineStatusBadge';
import { SessionAuditLog } from './SessionAuditLog';
import { SummaryDisplay } from '../replay/SummaryDisplay';
import type { ActivitySession } from './RecordingSlider';

interface BroadcastActivityCardProps {
  session: ActivitySession;
}

export function formatHumanDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
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

function ThumbnailPlaceholder() {
  return (
    <div className="w-full aspect-video bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
      <svg className="w-12 h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    </div>
  );
}

export function BroadcastActivityCard({ session }: BroadcastActivityCardProps) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const timestamp = formatDate(session.endedAt || session.createdAt);
  const duration = session.recordingDuration
    ? formatHumanDuration(session.recordingDuration)
    : null;

  const thumbnailSrc = session.thumbnailUrl || session.posterFrameUrl;
  const showThumbnail = thumbnailSrc && !imgError;

  return (
    <Card
      className="group hover:shadow-lg cursor-pointer transition-all duration-300"
      onClick={() => navigate(`/replay/${session.sessionId}`)}
    >
      {/* Thumbnail or placeholder — full-width, aspect-ratio */}
      {showThumbnail ? (
        <img
          src={thumbnailSrc}
          alt=""
          data-testid="thumbnail"
          onError={() => setImgError(true)}
          className="w-full aspect-video object-cover group-hover:scale-[1.02] transition-transform duration-300"
        />
      ) : (
        <ThumbnailPlaceholder />
      )}

      {/* Card content */}
      <Card.Body>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Avatar name={session.userId} alt={session.userId || 'Broadcaster'} size="sm" />
              <h3 className="font-semibold text-gray-900 truncate text-[15px]">{session.userId}</h3>
              {session.sessionType === 'UPLOAD' && (
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  Upload
                </span>
              )}
              <PipelineStatusBadge session={session} />
            </div>
            <p className="text-xs text-gray-400 mt-1.5 ml-[42px] flex items-center gap-1.5">
              {session.sourceFileName && (
                <>
                  <span className="truncate max-w-[140px]">{session.sourceFileName}</span>
                  <span className="text-gray-300">&middot;</span>
                </>
              )}
              {duration && (
                <>
                  <span>{duration}</span>
                  <span className="text-gray-300">&middot;</span>
                </>
              )}
              <span>{timestamp}</span>
            </p>
          </div>
        </div>

        <div className="mt-3 ml-[42px]">
          <ReactionSummaryPills reactionSummary={session.reactionSummary} />
        </div>

        {/* AI Summary (Phase 20) */}
        <div className="mt-2.5 ml-[42px]">
          <SummaryDisplay
            summary={session.aiSummary}
            status={session.aiSummaryStatus}
            truncate={true}
            className="text-gray-700"
          />
        </div>

        {/* Highlights badge */}
        {(session as any).highlightReelStatus === 'available' && (
          <div className="mt-2 ml-[42px]">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/replay/${session.sessionId}?view=highlights`);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200 hover:bg-fuchsia-100 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 4V2m0 2a2 2 0 00-2 2v1a2 2 0 002 2h0a2 2 0 002-2V6a2 2 0 00-2-2zm0 10v2m0-2a2 2 0 01-2-2v-1a2 2 0 012-2h0a2 2 0 012 2v1a2 2 0 01-2 2zM17 4V2m0 2a2 2 0 00-2 2v1a2 2 0 002 2h0a2 2 0 002-2V6a2 2 0 00-2-2zm0 10v2m0-2a2 2 0 01-2-2v-1a2 2 0 012-2h0a2 2 0 012 2v1a2 2 0 01-2 2z" />
              </svg>
              Highlights
            </button>
          </div>
        )}

        {/* Audit Log - Processing Timeline */}
        <div className="ml-[42px]">
          <SessionAuditLog session={session} compact={true} />
        </div>
      </Card.Body>
    </Card>
  );
}
