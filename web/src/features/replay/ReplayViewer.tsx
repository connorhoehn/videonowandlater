/**
 * ReplayViewer - dedicated page for watching replay videos with HLS playback
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getConfig } from '../../config/aws-config';
import { useReplayPlayer } from './useReplayPlayer';

interface Session {
  sessionId: string;
  userId: string;
  recordingHlsUrl?: string;
  recordingDuration?: number; // milliseconds
  createdAt: string;
  endedAt?: string;
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

  // Fetch session metadata
  useEffect(() => {
    if (!sessionId) return;

    const fetchSession = async () => {
      const config = getConfig();
      const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`);

        if (!response.ok) {
          if (response.status === 404) {
            setError('Recording not found');
          } else {
            setError(`Failed to load recording: ${response.statusText}`);
          }
          setLoading(false);
          return;
        }

        const data: Session = await response.json();
        setSession(data);
      } catch (err: any) {
        setError(`Error loading recording: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [sessionId]);

  // IVS Player hook
  const { videoRef } = useReplayPlayer(session?.recordingHlsUrl);

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
        {/* Video container */}
        <div className="aspect-video bg-black rounded-lg overflow-hidden shadow-lg">
          <video
            ref={videoRef}
            controls
            playsInline
            className="w-full h-full"
          />
        </div>

        {/* Metadata panel */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
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
        </div>
      </div>
    </div>
  );
}
