/**
 * ReplayViewer - dedicated page for watching replay videos with HLS playback
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchToken } from '../../auth/fetchToken';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../../config/aws-config';
import { useReplayPlayer } from './useReplayPlayer';
import { ReplayChat } from './ReplayChat';
import { ReactionTimeline } from './ReactionTimeline';
import { useReactionSync } from './useReactionSync';
import { FloatingReactions, type FloatingEmoji } from '../reactions/FloatingReactions';
import { ReplayReactionPicker } from './ReplayReactionPicker';
import { useReactionSender } from '../reactions/useReactionSender';
import { EMOJI_MAP, type EmojiType } from '../reactions/ReactionPicker';
import { ReactionSummaryPills } from '../activity/ReactionSummaryPills';
import { SessionAuditLog } from '../activity/SessionAuditLog';
import { SummaryDisplay } from './SummaryDisplay';
import { TranscriptDisplay } from './TranscriptDisplay';
import { ChapterList } from './ChapterList';
import { HighlightReelPlayer } from './HighlightReelPlayer';
import { Card } from '../../components/social';
import type { Chapter } from './ChapterList';
import type { Reaction } from '../../../../backend/src/domain/reaction';

interface Session {
  sessionId: string;
  userId: string;
  sessionType: 'BROADCAST' | 'HANGOUT' | 'UPLOAD';
  recordingHlsUrl?: string;
  recordingDuration?: number; // milliseconds
  createdAt: string;
  endedAt?: string;
  reactionSummary?: Record<string, number>;
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'available' | 'failed';
  visualAnalysis?: string;
  recordingStatus?: 'pending' | 'processing' | 'available' | 'failed';
  transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
  convertStatus?: 'pending' | 'processing' | 'available' | 'failed';
  mediaConvertJobName?: string;
  diarizedTranscriptS3Path?: string;
  chapters?: Chapter[];
  posterFrameUrl?: string;
  thumbnailBaseUrl?: string;
  thumbnailCount?: number;
  highlightReelStatus?: 'pending' | 'processing' | 'available' | 'failed';
  highlightReelLandscapeUrl?: string;
  highlightReelVerticalUrl?: string;
}

/**
 * Format duration from milliseconds to MM:SS
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function ReplayViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allReactions, setAllReactions] = useState<Reaction[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingEmoji[]>([]);
  const [authToken, setAuthToken] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'transcript'>('chat');
  const [viewMode, setViewMode] = useState<'replay' | 'highlights'>(
    searchParams.get('view') === 'highlights' ? 'highlights' : 'replay'
  );

  useEffect(() => {
    fetchToken().then(({ token, username }) => {
      if (username) setCurrentUserId(username);
      setAuthToken(token);
    });
  }, []);

  // Check if the pipeline is still processing
  const isPipelineComplete = (s: Session | null): boolean => {
    if (!s) return false;
    const terminalStatuses = ['available', 'failed'];
    const transcriptDone = !s.transcriptStatus || terminalStatuses.includes(s.transcriptStatus);
    const summaryDone = !s.aiSummaryStatus || terminalStatuses.includes(s.aiSummaryStatus);
    const convertDone = !s.convertStatus || terminalStatuses.includes(s.convertStatus);
    const highlightDone = !s.highlightReelStatus || terminalStatuses.includes(s.highlightReelStatus);
    return transcriptDone && summaryDone && convertDone && highlightDone;
  };

  // Fetch session metadata with polling while pipeline is active
  useEffect(() => {
    if (!sessionId || !authToken) return;

    let pollTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const fetchSession = async (isInitial: boolean) => {
      const config = getConfig();
      const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';
      const url = `${apiBaseUrl}/sessions/${sessionId}`;

      if (isInitial) {
        console.log('[ReplayViewer] fetching session', { sessionId, url, hasToken: !!authToken });
      }

      try {
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });

        if (cancelled) return;

        if (!response.ok) {
          if (isInitial) {
            if (response.status === 404) {
              setError('Recording not found');
            } else {
              setError(`Failed to load recording: ${response.status} ${response.statusText}`);
            }
          }
          return;
        }

        const data = await response.json();
        const sessionWithDefaults: Session = {
          ...data,
          sessionType: data.sessionType || data.type || 'BROADCAST',
        };

        if (isInitial) {
          console.log('[ReplayViewer] session loaded', {
            sessionId: sessionWithDefaults.sessionId,
            recordingStatus: sessionWithDefaults.recordingStatus,
            recordingHlsUrl: sessionWithDefaults.recordingHlsUrl,
          });
        }

        setSession(sessionWithDefaults);

        // Schedule next poll if pipeline is still processing
        if (!cancelled && !isPipelineComplete(sessionWithDefaults)) {
          pollTimer = setTimeout(() => fetchSession(false), 5000);
        }
      } catch (err: any) {
        if (isInitial) {
          console.error('[ReplayViewer] fetch error', err);
          setError(`Error loading recording: ${err.message}`);
        }
      } finally {
        if (isInitial) setLoading(false);
      }
    };

    fetchSession(true);

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
    };
  }, [sessionId, authToken]);

  // IVS Player hook
  const { videoRef, syncTime } = useReplayPlayer(session?.recordingHlsUrl);

  // Seek handler: TranscriptDisplay click-to-seek → video element
  const handleSeek = (timeMs: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timeMs / 1000;
    }
  };

  // Fetch reactions on mount
  useEffect(() => {
    if (!sessionId || !authToken) return;

    const fetchReactions = async () => {
      const config = getConfig();
      const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/reactions`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (response.ok) {
          const data = await response.json();
          setAllReactions(data.reactions || []);
        }
      } catch (err) {
        console.error('Failed to fetch reactions:', err);
      }
    };

    fetchReactions();
  }, [sessionId, authToken]);

  // Filter reactions by syncTime
  const visibleReactions = useReactionSync(allReactions, syncTime);

  // Track last visible count to detect new reactions
  const [lastVisibleCount, setLastVisibleCount] = useState(0);

  // Handle floating display when visible reactions change
  useEffect(() => {
    if (visibleReactions.length > lastVisibleCount) {
      // New reactions became visible, add them to floating display
      const newReactions = visibleReactions.slice(lastVisibleCount);
      const newFloating = newReactions.map((reaction) => ({
        id: reaction.reactionId,
        emoji: EMOJI_MAP[reaction.emojiType as keyof typeof EMOJI_MAP] || '❤️',
        timestamp: Date.now(),
      }));
      setFloatingReactions((prev) => [...prev, ...newFloating]);
    }
    setLastVisibleCount(visibleReactions.length);
  }, [visibleReactions, lastVisibleCount]);

  // Reaction sender hook
  const { sendReaction } = useReactionSender(sessionId || '', authToken);

  // Handle replay reaction send
  const handleReaction = async (emoji: EmojiType) => {
    const result = await sendReaction(emoji, 'replay');
    if (result) {
      // Add to allReactions array for immediate display
      const newReaction: Reaction = {
        reactionId: result.reactionId,
        sessionId: sessionId || '',
        userId: currentUserId,
        emojiType: emoji,
        reactionType: 'replay' as any,
        reactedAt: new Date().toISOString(),
        sessionRelativeTime: result.sessionRelativeTime,
        shardId: 0,
      };
      setAllReactions((prev) => [...prev, newReaction]);

      // Optimistic floating animation
      setFloatingReactions((prev) => [
        ...prev,
        {
          id: uuidv4(),
          emoji: EMOJI_MAP[emoji],
          timestamp: Date.now(),
        },
      ]);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading recording...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md text-center">
          <div className="text-red-600 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {error}
          </h2>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Recording not available state
  if (!session?.recordingHlsUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md text-center">
          <div className="text-gray-400 text-5xl mb-4">📹</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Recording not available
          </h2>
          <p className="text-gray-600 mb-4">
            This session hasn't been recorded yet or the recording is still processing.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white/95 backdrop-blur-md border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-lg font-semibold text-gray-900">Replay</h1>
          <button
            onClick={() => navigate('/')}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
          >
            ← Back
          </button>
        </div>
      </div>

      {/* View mode tabs (Replay / Highlights) */}
      {session?.highlightReelStatus && (
        <div className="max-w-6xl mx-auto px-4 pt-4">
          <div className="flex bg-gray-100 rounded-lg p-0.5 w-fit">
            <button
              onClick={() => setViewMode('replay')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                viewMode === 'replay'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Replay
            </button>
            <button
              onClick={() => setViewMode('highlights')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                viewMode === 'highlights'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Highlights
            </button>
          </div>
        </div>
      )}

      {/* Highlights view */}
      {viewMode === 'highlights' && session?.highlightReelStatus && (
        <div className="max-w-4xl mx-auto p-4">
          <Card>
            <Card.Header>
              <h3 className="text-sm font-semibold text-gray-900">Highlight Reel</h3>
            </Card.Header>
            <Card.Body>
              <HighlightReelPlayer
                landscapeUrl={session.highlightReelLandscapeUrl}
                verticalUrl={session.highlightReelVerticalUrl}
                status={session.highlightReelStatus}
              />
            </Card.Body>
          </Card>
        </div>
      )}

      {/* Main content */}
      <div className="max-w-6xl mx-auto p-4" style={{ display: viewMode === 'replay' ? undefined : 'none' }}>
        {/* Responsive grid layout: video + metadata on left, chat on right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Video column (takes 2/3 width on desktop) */}
          <div className="lg:col-span-2">
            {/* Video container with floating reactions */}
            <Card>
              <div className="relative aspect-video bg-black overflow-hidden">
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  className="w-full h-full"
                />
                {/* Floating reactions overlay */}
                <FloatingReactions reactions={floatingReactions} />
              </div>

              {/* Reaction timeline below video */}
              {session?.recordingDuration && (
                <Card.Body>
                  <ReactionTimeline
                    reactions={allReactions}
                    currentTime={syncTime}
                    duration={session.recordingDuration}
                  />
                </Card.Body>
              )}

              {/* Reaction picker */}
              <Card.Footer borderless={!!session?.recordingDuration}>
                <div className="flex justify-center">
                  <ReplayReactionPicker
                    onReaction={handleReaction}
                    disabled={!authToken}
                  />
                </div>
              </Card.Footer>
            </Card>

            {/* Chapter navigation */}
            {session.chapters && session.chapters.length > 0 && (
              <Card className="mt-4">
                <Card.Header>
                  <h3 className="text-sm font-semibold text-gray-900">Chapters</h3>
                </Card.Header>
                <Card.Body>
                  <ChapterList
                    chapters={session.chapters}
                    currentTimeMs={syncTime}
                    thumbnailBaseUrl={session.thumbnailBaseUrl}
                    onSeek={handleSeek}
                  />
                </Card.Body>
              </Card>
            )}

            {/* Metadata panel */}
            <Card className="mt-4">
              <Card.Header>
                <h3 className="text-sm font-semibold text-gray-900">Details</h3>
              </Card.Header>
              <Card.Body>
                <div className="space-y-3">
                  <div>
                    <span className="text-sm font-medium text-gray-500">Broadcaster</span>
                    <p className="text-base text-gray-900 mt-1">
                      {session.userId}
                    </p>
                  </div>

                  {session.recordingDuration !== undefined && (
                    <div>
                      <span className="text-sm font-medium text-gray-500">Duration</span>
                      <p className="text-base text-gray-900 mt-1">
                        {formatDuration(session.recordingDuration)}
                      </p>
                    </div>
                  )}

                  <div>
                    <span className="text-sm font-medium text-gray-500">Recorded</span>
                    <p className="text-base text-gray-900 mt-1">
                      {new Date(session.createdAt).toLocaleString()}
                    </p>
                  </div>

                  {session.endedAt && (
                    <div>
                      <span className="text-sm font-medium text-gray-500">Ended</span>
                      <p className="text-base text-gray-900 mt-1">
                        {new Date(session.endedAt).toLocaleString()}
                      </p>
                    </div>
                  )}

                  <div className="pt-2 border-t border-gray-200">
                    <span className="text-xs text-gray-400">Session ID: {session.sessionId}</span>
                  </div>
                </div>
              </Card.Body>
            </Card>

            {/* AI Summary */}
            <Card className="mt-4">
              <Card.Header>
                <h3 className="text-sm font-semibold text-gray-900">AI Summary</h3>
              </Card.Header>
              <Card.Body>
                <SummaryDisplay
                  summary={session.aiSummary}
                  status={session.aiSummaryStatus}
                  visualAnalysis={session.visualAnalysis}
                  truncate={false}
                  className="text-gray-800"
                />
              </Card.Body>
            </Card>

            {/* Processing Timeline Audit Log */}
            <Card className="mt-4">
              <Card.Header>
                <h3 className="text-sm font-semibold text-gray-900">Processing Timeline</h3>
              </Card.Header>
              <Card.Body>
                <SessionAuditLog session={session} compact={false} />
              </Card.Body>
            </Card>

            {/* Reactions */}
            <Card className="mt-4">
              <Card.Header>
                <h3 className="text-sm font-semibold text-gray-900">Reactions</h3>
              </Card.Header>
              <Card.Body>
                <ReactionSummaryPills reactionSummary={session?.reactionSummary} />
              </Card.Body>
            </Card>
          </div>

          {/* Chat/Transcript column (takes 1/3 width on desktop) */}
          <div className="lg:col-span-1 h-[400px] sm:h-[500px] lg:h-[600px] flex flex-col">
            <Card className="flex flex-col h-full">
              {/* Tab buttons */}
              <Card.Header borderless className="p-0">
                <div className="flex w-full">
                  <button
                    onClick={() => setActiveTab('chat')}
                    className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                      activeTab === 'chat'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    Chat Replay
                  </button>
                  <button
                    onClick={() => setActiveTab('transcript')}
                    className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                      activeTab === 'transcript'
                        ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    Transcript
                    {session?.transcriptStatus === 'available' && (
                      <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                        Ready
                      </span>
                    )}
                    {session?.transcriptStatus === 'processing' && (
                      <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                        Processing
                      </span>
                    )}
                  </button>
                </div>
              </Card.Header>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden relative">
                <div className={`absolute inset-0 transition-all duration-200 ease-out ${activeTab === 'chat' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none'}`}>
                  <ReplayChat sessionId={sessionId!} currentSyncTime={syncTime} authToken={authToken} />
                </div>
                <div className={`absolute inset-0 transition-all duration-200 ease-out ${activeTab === 'transcript' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2 pointer-events-none'}`}>
                  <TranscriptDisplay sessionId={sessionId!} currentTime={syncTime} authToken={authToken} diarizedTranscriptS3Path={session.diarizedTranscriptS3Path} onSeek={handleSeek} />
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
