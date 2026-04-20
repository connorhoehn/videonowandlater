/**
 * BroadcastActivityCard - Activity card for broadcast sessions
 * Displays userId, duration, reaction summary pills, AI summary (2-line truncated), and relative timestamp
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import Hls from 'hls.js';
import { useNavigate } from 'react-router-dom';
import { Card, Avatar } from '../../components/social';
import { ReactionSummaryPills } from './ReactionSummaryPills';
import { PipelineStatusBadge } from './PipelineStatusBadge';
import { SessionAuditLog } from './SessionAuditLog';
import { SummaryDisplay } from '../replay/SummaryDisplay';
import { formatDate, formatHumanDuration, getSessionRoute } from './utils';
import { LiveBadge } from './LiveBadge';
import { PinBadge } from './PinBadge';
import { LiveDuration } from './LiveDuration';
import { ProcessingOverlay } from './ProcessingOverlay';
import { LiveActionButton } from './LiveActionButton';
import type { ActivitySession } from './RecordingSlider';

// Re-export for backwards compatibility
export { formatHumanDuration } from './utils';

interface BroadcastActivityCardProps {
  session: ActivitySession;
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
  // Only hide the thumbnail once the video is actually rendering frames — otherwise
  // hovering over a card whose HLS source fails (CORS, 403, codec) flashes pure
  // white because the <video> element has no poster and the thumbnail fades out.
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
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

  // Lazy-attach hls.js on first hover. Native <video src={hls}> only works in
  // Safari — Chrome/Firefox fail silently without hls.js.
  const attachHls = useCallback(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl || hlsRef.current) return;
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
    }
  }, [hlsUrl]);

  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!hlsUrl || !isReady || isLive) return;
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(true);
      attachHls();
      const video = videoRef.current;
      if (video) {
        video.muted = isMuted;
        video.play().catch(() => {});
      }
    }, 400);
  }, [hlsUrl, isReady, isLive, isMuted, attachHls]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimeoutRef.current);
    setIsHovering(false);
    setIsVideoPlaying(false);
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

  const route = getSessionRoute({ sessionId: session.sessionId, sessionType: session.sessionType, status: session.status });

  return (
    <Card
      className={`group transition-all duration-300 ${isReady ? 'hover:shadow-lg cursor-pointer' : 'cursor-default'} ${isLive ? 'ring-2 ring-red-500/50' : ''}`}
      onClick={isReady ? () => navigate(route) : undefined}
    >
      {/* Thumbnail with hover-to-play video preview */}
      <div
        className="relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {isLive && <LiveBadge variant="broadcast" />}
        {session.isPinned && <PinBadge />}
        {showThumbnail ? (
          <img
            src={thumbnailSrc}
            alt={`${session.userId} broadcast thumbnail`}
            data-testid="thumbnail"
            onError={() => setImgError(true)}
            className={`w-full aspect-video object-cover transition-opacity duration-300 ${isHovering && isVideoPlaying ? 'opacity-0' : 'opacity-100'}`}
          />
        ) : (
          <ThumbnailPlaceholder />
        )}

        {/* Video preview on hover (skip for live sessions) */}
        {hlsUrl && isReady && !isLive && (
          <video
            ref={videoRef}
            muted={isMuted}
            playsInline
            loop
            preload="none"
            onPlaying={() => setIsVideoPlaying(true)}
            onPause={() => setIsVideoPlaying(false)}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isHovering && isVideoPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          />
        )}

        {/* Live duration badge */}
        {isLive && !isHovering && (
          <span className="absolute bottom-2 left-3 px-1.5 py-0.5 text-xs font-medium text-white bg-black/70 rounded">
            <LiveDuration createdAt={session.createdAt} />
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

        <ProcessingOverlay visible={!isReady && !isLive} message="Processing..." />
        {!isReady && !isLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-20 pointer-events-none">
            <span className="text-white/60 text-xs mt-12">Recording will be available soon</span>
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
            <LiveActionButton sessionId={session.sessionId} sessionType={session.sessionType} />
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
