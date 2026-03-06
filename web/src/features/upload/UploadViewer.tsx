/**
 * UploadViewer - Viewer page for uploaded videos with playback and transcript
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { getConfig } from '../../config/aws-config';
import { useReplayPlayer } from '../replay/useReplayPlayer';
import { TranscriptDisplay } from '../replay/TranscriptDisplay';
import { SummaryDisplay } from '../replay/SummaryDisplay';
import { SessionAuditLog } from '../activity/SessionAuditLog';

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

export function UploadViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [session, setSession] = useState<UploadSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    fetchAuthSession().then(session => {
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

      try {
        const response = await fetch(url, {
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

        // Verify this is an upload session
        if (data.sessionType !== 'UPLOAD') {
          navigate(`/replay/${sessionId}`);
          return;
        }

        setSession(data);
      } catch (err: any) {
        console.error('Fetch error', err);
        setError(`Error loading video: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, authToken, navigate]);

  // IVS Player hook
  const { videoRef, syncTime } = useReplayPlayer(session?.recordingHlsUrl);

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
          <div className="text-red-600 text-5xl mb-4">⚠️</div>
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

  // Video not available state
  if (!session.recordingHlsUrl) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white p-8 rounded-lg shadow-md text-center">
          <div className="text-gray-400 text-5xl mb-4">⏳</div>
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
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-gray-600 hover:text-gray-900 transition-colors"
            >
              ← Back
            </button>
            <h1 className="text-xl font-semibold text-gray-900">
              {session.sourceFileName || 'Uploaded Video'}
            </h1>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video and info column (takes 2/3 width on desktop) */}
          <div className="lg:col-span-2">
            {/* Video container */}
            <div className="relative aspect-video bg-black rounded-lg overflow-hidden shadow-lg">
              <video
                ref={videoRef}
                controls
                playsInline
                className="w-full h-full"
              />
            </div>

            {/* Video info panel */}
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
          </div>

          {/* Transcript column (takes 1/3 width on desktop) */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden h-[600px] flex flex-col">
              {/* Transcript toggle for mobile */}
              <div className="lg:hidden p-4 border-b border-gray-200">
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className="w-full text-left flex items-center justify-between"
                >
                  <span className="font-semibold text-gray-700">Transcript</span>
                  <svg
                    className={`w-5 h-5 text-gray-500 transform transition-transform ${
                      showTranscript ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Transcript content */}
              <div className={`flex-1 ${!showTranscript && 'hidden lg:block'}`}>
                <TranscriptDisplay
                  sessionId={sessionId!}
                  currentTime={syncTime}
                  authToken={authToken}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}