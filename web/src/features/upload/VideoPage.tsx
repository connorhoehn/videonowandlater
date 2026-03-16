/**
 * VideoPage - Dedicated player page for uploaded videos at /video/:sessionId
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getConfig } from '../../config/aws-config';
import { useHlsPlayer } from './useHlsPlayer';
import { QualitySelector } from './QualitySelector';
import { SessionAuditLog } from '../activity/SessionAuditLog';
import { SummaryDisplay } from '../replay/SummaryDisplay';
import { ReplayReactionPicker } from '../replay/ReplayReactionPicker';
import { ReactionSummaryPills } from '../activity/ReactionSummaryPills';
import { useReactionSender } from '../reactions/useReactionSender';
import { CommentThread } from './CommentThread';
import { VideoInfoPanel } from './VideoInfoPanel';

interface UploadSession {
  sessionId: string;
  userId: string;
  sessionType: 'UPLOAD';
  recordingHlsUrl?: string;
  recordingDuration?: number;
  createdAt: string;
  endedAt?: string;
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'available' | 'failed';
  recordingStatus?: 'pending' | 'processing' | 'available' | 'failed';
  transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
  convertStatus?: 'pending' | 'processing' | 'available' | 'failed';
  sourceFileName?: string;
  sourceFileSize?: number;
  uploadStatus?: string;
  diarizedTranscriptS3Path?: string;
  reactionSummary?: Record<string, number>;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function isUploadTerminal(session: UploadSession): boolean {
  const anyFailed = [session.convertStatus, session.transcriptStatus, session.aiSummaryStatus, session.recordingStatus]
    .some(s => s === 'failed');
  return anyFailed || session.aiSummaryStatus === 'available';
}

export function VideoPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<UploadSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [allReactions, setAllReactions] = useState<Array<{ emojiType: string }>>([]);
  const [pollInterval, setPollInterval] = useState(15000);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch auth token once on mount
  useEffect(() => {
    fetchAuthSession().then(s => {
      setAuthToken(s.tokens?.idToken?.toString() || '');
    });
  }, []);

  // Fetch session metadata and reactions
  useEffect(() => {
    if (!sessionId || !authToken) return;

    const fetchSession = async () => {
      const config = getConfig();
      const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });

        if (!response.ok) {
          if (response.status === 404) {
            setError('Video not found');
          } else {
            setError(`Failed to load video: ${response.status}`);
          }
          setLoading(false);
          return;
        }

        const data: UploadSession = await response.json();

        // If not an upload session, redirect to replay
        if (data.sessionType !== 'UPLOAD') {
          navigate(`/replay/${sessionId}`);
          return;
        }

        setSession(data);

        // Fetch reactions after session is set
        try {
          const reactionsRes = await fetch(`${apiBaseUrl}/sessions/${sessionId}/reactions`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
          });
          if (reactionsRes.ok) {
            const reactionsData = await reactionsRes.json();
            setAllReactions(reactionsData.reactions || []);
          }
        } catch (err) {
          console.error('Failed to fetch reactions:', err);
        }
      } catch (err: any) {
        console.error('Fetch error', err);
        setError(`Error loading video: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, authToken, navigate]);

  // Polling useEffect — re-fetch session when pipeline is non-terminal
  useEffect(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (!session || isUploadTerminal(session) || !authToken || !sessionId) return;
    const config = getConfig();
    const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';
    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`, {
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (response.ok) {
          const data: UploadSession = await response.json();
          setSession(data);
        }
      } catch {
        // silent — polling errors should not surface as errors
      }
      setPollInterval(prev => Math.min(prev * 2, 60000));
    }, pollInterval);
    pollIntervalRef.current = intervalId;
    return () => {
      clearInterval(intervalId);
      pollIntervalRef.current = null;
    };
  }, [session, pollInterval, sessionId, authToken]);

  // HLS player hook
  const { videoRef, qualities, currentQuality, setQuality, isSafari, syncTime } = useHlsPlayer(session?.recordingHlsUrl);

  // seekVideo callback — seeks the HLS video element to the given time
  const seekVideo = (timeMs: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timeMs / 1000;
    }
  };

  // Reaction sender
  const { sendReaction } = useReactionSender(sessionId || '', authToken);

  // Compute reaction counts: merge pre-existing summary with freshly fetched reactions
  const reactionCounts = allReactions.reduce((acc, r) => {
    acc[r.emojiType] = (acc[r.emojiType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const displayCounts = { ...session?.reactionSummary, ...reactionCounts };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading video...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md text-center">
          <div className="text-red-600 text-5xl mb-4">&#9888;</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {error || 'Video not found'}
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

  // Video not yet available state
  if (!session.recordingHlsUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md text-center">
          <div className="text-gray-400 text-5xl mb-4">&#8987;</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Video still processing
          </h2>
          <p className="text-gray-600 mb-4">
            Your upload is being processed. Please check back in a few moments.
          </p>
          <SessionAuditLog session={session} compact={false} />
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
      {/* Header bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="text-gray-600 hover:text-gray-900 transition-colors"
          >
            &#8592; Back
          </button>
          <h1 className="text-xl font-semibold text-gray-900">
            {session.sourceFileName || 'Uploaded Video'}
          </h1>
        </div>
      </div>

      {/* Content area */}
      <div className="max-w-4xl mx-auto p-4">
        {/* Video container with quality selector overlay */}
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden shadow-lg">
          <video
            ref={videoRef}
            controls
            playsInline
            className="w-full h-full"
          />
          <div className="absolute bottom-3 right-3 z-10">
            <QualitySelector
              qualities={qualities}
              currentQuality={currentQuality}
              onSelect={setQuality}
              isSafari={isSafari}
            />
          </div>
        </div>

        {/* Video metadata panel */}
        <div className="mt-4 bg-white rounded-lg shadow p-6">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <span className="text-sm font-medium text-gray-500">Uploaded by</span>
              <p className="text-base text-gray-900 mt-1">{session.userId}</p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500">File size</span>
              <p className="text-base text-gray-900 mt-1">
                {formatFileSize(session.sourceFileSize)}
              </p>
            </div>
            {session.recordingDuration && (
              <div>
                <span className="text-sm font-medium text-gray-500">Duration</span>
                <p className="text-base text-gray-900 mt-1">
                  {formatDuration(session.recordingDuration)}
                </p>
              </div>
            )}
            <div>
              <span className="text-sm font-medium text-gray-500">Uploaded</span>
              <p className="text-base text-gray-900 mt-1">
                {new Date(session.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          {/* AI Summary */}
          <div className="pt-4 border-t">
            <h3 className="text-sm font-semibold text-gray-600 uppercase mb-2">AI Summary</h3>
            <SummaryDisplay
              summary={session.aiSummary}
              status={session.aiSummaryStatus}
              truncate={false}
              className="text-gray-800"
            />
          </div>

          {/* Processing Status */}
          <div className="mt-4 pt-4 border-t">
            <h3 className="text-sm font-semibold text-gray-600 uppercase mb-3">Processing Status</h3>
            <SessionAuditLog session={session} compact={false} />
          </div>
        </div>

        {/* Reactions */}
        <div className="mt-4 bg-white rounded-lg shadow p-4 flex flex-wrap items-center gap-4">
          <ReplayReactionPicker onReaction={(emoji) => sendReaction(emoji, 'replay')} />
          <ReactionSummaryPills reactionSummary={displayCounts} />
        </div>

        {/* Comment Thread */}
        <div className="mt-4">
          <CommentThread
            sessionId={sessionId!}
            authToken={authToken}
            syncTime={syncTime}
            onSeek={seekVideo}
          />
        </div>

        {/* Info Panel toggle */}
        <div className="mt-4">
          <button
            onClick={() => setShowInfoPanel(p => !p)}
            className="w-full text-left px-6 py-3 bg-white border rounded-lg shadow text-sm font-medium text-gray-700 flex justify-between items-center"
          >
            <span>Summary &amp; Transcript</span>
            <span>{showInfoPanel ? '▲' : '▼'}</span>
          </button>
          {showInfoPanel && (
            <div className="mt-2 bg-white rounded-lg shadow">
              <VideoInfoPanel
                sessionId={sessionId!}
                authToken={authToken}
                syncTime={syncTime}
                aiSummary={session.aiSummary}
                aiSummaryStatus={session.aiSummaryStatus}
                diarizedTranscriptS3Path={session.diarizedTranscriptS3Path}
                onSeek={seekVideo}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
