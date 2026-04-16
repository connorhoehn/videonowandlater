/**
 * BroadcastActivityCard - Activity card for broadcast sessions
 * Displays userId, duration, reaction summary pills, AI summary (2-line truncated), and relative timestamp
 */

import { useState, useRef, useCallback, useEffect } from 'react';
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
  const [isHovering, setIsHovering] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const timestamp = formatDate(session.endedAt || session.createdAt);
  const duration = session.recordingDuration
    ? formatHumanDuration(session.recordingDuration)
    : null;

  const thumbnailSrc = session.thumbnailUrl || session.posterFrameUrl;
  const showThumbnail = thumbnailSrc && !imgError;
  const hlsUrl = session.recordingHlsUrl;

  const isLive = session.status === 'live';
  const isReady = isLive || session.recordingStatus === 'available' || !!hlsUrl;

  // Live duration counter
  const [liveDuration, setLiveDuration] = useState('');

  useEffect(() => {
    if (!isLive) return;
    const tick = () => {
      const elapsed = Date.now() - new Date(session.createdAt).getTime();
      const mins = Math.floor(elapsed / 60000);
      const hrs = Math.floor(mins / 60);
      setLiveDuration(hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [isLive, session.createdAt]);

  const handleMouseEnter = useCallback(() => {
    if (!hlsUrl || !isReady || isLive) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
      const video = videoRef.current;
      if (video) {
        video.muted = isMuted;
        video.play().catch(() => {});
      }
    }, 400);
  }, [hlsUrl, isReady, isMuted]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimeoutRef.current);
    setIsHovering(false);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }, []);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !isMuted;
    setIsMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  }, [isMuted]);

  return (
    <Card
      className={`group transition-all duration-300 ${isReady ? 'hover:shadow-lg cursor-pointer' : 'cursor-default'} ${isLive ? 'ring-2 ring-red-500/50' : ''}`}
      onClick={isReady ? () => navigate(isLive ? `/viewer/${session.sessionId}` : `/replay/${session.sessionId}`) : undefined}
    >
      {/* Thumbnail with hover-to-play video preview */}
      <div
        className="relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {isLive && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-lg shadow-red-600/30">
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
        {showThumbnail ? (
          <img
            src={thumbnailSrc}
            alt={`${session.userId} broadcast thumbnail`}
            data-testid="thumbnail"
            onError={() => setImgError(true)}
            className={`w-full aspect-video object-cover transition-opacity duration-300 ${isHovering ? 'opacity-0' : 'opacity-100'}`}
          />
        ) : (
          <ThumbnailPlaceholder />
        )}

        {/* Video preview on hover (skip for live sessions) */}
        {hlsUrl && isReady && !isLive && (
          <video
            ref={videoRef}
            src={hlsUrl}
            muted={isMuted}
            playsInline
            loop
            preload="none"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isHovering ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          />
        )}

        {/* Live duration badge */}
        {isLive && liveDuration && !isHovering && (
          <span className="absolute bottom-2 left-3 px-1.5 py-0.5 text-xs font-medium text-white bg-black/70 rounded">
            {liveDuration}
          </span>
        )}

        {/* Mute toggle button — visible on hover */}
        {isHovering && hlsUrl && !isLive && (
          <button
            type="button"
            onClick={toggleMute}
            className="absolute bottom-2 right-2 z-10 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors cursor-pointer"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            )}
          </button>
        )}

        {/* Duration badge */}
        {duration && !isHovering && (
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 text-xs font-medium text-white bg-black/70 rounded">
            {duration}
          </span>
        )}

        {!isReady && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
            <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-white text-sm font-medium">Processing...</span>
            <span className="text-white/60 text-xs">Recording will be available soon</span>
          </div>
        )}
      </div>

      {/* Card content */}
      <Card.Body>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Avatar name={session.userId} alt={session.userId || 'Broadcaster'} size="sm" />
              <h3 className="font-semibold text-gray-900 dark:text-white truncate text-[15px]">{session.userId}</h3>
              {session.sessionType === 'UPLOAD' && (
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  Upload
                </span>
              )}
              <PipelineStatusBadge session={session} />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5 ml-[42px] flex items-center gap-1.5">
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
            visualAnalysis={session.visualAnalysis}
            truncate={true}
            className="text-gray-700 dark:text-gray-300"
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

        {/* Watch Live CTA */}
        {isLive && (
          <div className="ml-[42px] mt-2">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/viewer/${session.sessionId}`); }}
              className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              Watch Live
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
