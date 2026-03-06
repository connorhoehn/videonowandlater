/**
 * ReplayViewer - dedicated page for watching replay videos with HLS playback
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
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
  recordingStatus?: 'pending' | 'processing' | 'available' | 'failed';
  transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
  convertStatus?: 'pending' | 'processing' | 'available' | 'failed';
  mediaConvertJobName?: string;
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
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allReactions, setAllReactions] = useState<Reaction[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<FloatingEmoji[]>([]);
  const [authToken, setAuthToken] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'transcript'>('chat');

  useEffect(() => {
    fetchAuthSession().then(session => {
      const username = session.tokens?.idToken?.payload?.['cognito:username'] as string | undefined;
      if (username) setCurrentUserId(username);
      setAuthToken(session.tokens?.idToken?.toString() || '');
    });
  }, []);

  // Fetch session metadata
  useEffect(() => {
    if (!sessionId || !authToken) return;

    const fetchSession = async () => {
      const config = getConfig();
      const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';
      const url = `${apiBaseUrl}/sessions/${sessionId}`;

      console.log('[ReplayViewer] fetching session', { sessionId, url, hasToken: !!authToken });

      try {
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });

        console.log('[ReplayViewer] session response', { status: response.status, ok: response.ok });

        if (!response.ok) {
          if (response.status === 404) {
            setError('Recording not found');
          } else {
            setError(`Failed to load recording: ${response.status} ${response.statusText}`);
          }
          setLoading(false);
          return;
        }

        const data = await response.json();
        // Ensure sessionType has a default value for backward compatibility
        const sessionWithDefaults: Session = {
          ...data,
          sessionType: data.sessionType || data.type || 'BROADCAST',
        };
        console.log('[ReplayViewer] session loaded', {
          sessionId: sessionWithDefaults.sessionId,
          recordingStatus: sessionWithDefaults.recordingStatus,
          recordingHlsUrl: sessionWithDefaults.recordingHlsUrl,
          status: (sessionWithDefaults as any).status,
        });
        setSession(sessionWithDefaults);
      } catch (err: any) {
        console.error('[ReplayViewer] fetch error', err);
        setError(`Error loading recording: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, authToken]);

  // IVS Player hook
  const { videoRef, syncTime } = useReplayPlayer(session?.recordingHlsUrl);

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
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-semibold text-gray-900">Replay</h1>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            ← Back to Home
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-6xl mx-auto p-4">
        {/* Responsive grid layout: video + metadata on left, chat on right */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Video column (takes 2/3 width on desktop) */}
          <div className="lg:col-span-2">
            {/* Video container with floating reactions */}
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden shadow-lg">
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
              <div className="mt-2">
                <ReactionTimeline
                  reactions={allReactions}
                  currentTime={syncTime}
                  duration={session.recordingDuration}
                />
              </div>
            )}

            {/* Reaction picker */}
            <div className="mt-2 flex justify-center">
              <ReplayReactionPicker
                onReaction={handleReaction}
                disabled={!authToken}
              />
            </div>

            {/* Metadata panel */}
            <div className="mt-4 bg-white rounded-lg shadow p-6">
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

                {/* AI Summary Section (Phase 20) */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase mb-2">AI Summary</h3>
                  <SummaryDisplay
                    summary={session.aiSummary}
                    status={session.aiSummaryStatus}
                    truncate={false}
                    className="text-gray-800"
                  />
                </div>

                {/* Processing Timeline Audit Log */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase mb-3">Processing Timeline</h3>
                  <SessionAuditLog session={session} compact={false} />
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-600 uppercase mb-2">Reactions</h3>
                  <ReactionSummaryPills reactionSummary={session?.reactionSummary} />
                </div>

                <div className="pt-2 border-t border-gray-200">
                  <span className="text-xs text-gray-400">Session ID: {session.sessionId}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Chat/Transcript column (takes 1/3 width on desktop, fixed height) */}
          <div className="lg:col-span-1 h-[600px] flex flex-col">
            {/* Tab buttons */}
            <div className="flex bg-white rounded-t-lg shadow-lg border-b border-gray-200">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'chat'
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                💬 Chat Replay
              </button>
              <button
                onClick={() => setActiveTab('transcript')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === 'transcript'
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                📝 Transcript
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

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {activeTab === 'chat' ? (
                <ReplayChat sessionId={sessionId!} currentSyncTime={syncTime} authToken={authToken} />
              ) : (
                <TranscriptDisplay sessionId={sessionId!} currentTime={syncTime} authToken={authToken} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
