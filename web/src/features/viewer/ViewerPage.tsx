/**
 * ViewerPage - viewer interface for watching live broadcasts
 */

import { useParams, useNavigate } from 'react-router-dom';
import { usePlayer } from './usePlayer';
import { VideoPlayer } from './VideoPlayer';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export function ViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  if (!sessionId) {
    return <div className="p-8 text-red-600">Session ID required</div>;
  }

  const { videoRef, isPlaying, sessionStatus, error } = usePlayer({
    sessionId,
    apiBaseUrl: API_BASE_URL,
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Watch Live</h1>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-gray-700 hover:text-gray-900"
          >
            ← Back
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6">
          <VideoPlayer videoRef={videoRef} isPlaying={isPlaying} />

          <div className="mt-6 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {isPlaying && (
                <span className="flex items-center text-sm text-gray-600">
                  <span className="w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></span>
                  LIVE
                </span>
              )}
              {sessionStatus && (
                <span className="text-sm text-gray-500">
                  Status: {sessionStatus}
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 text-xs text-gray-500">
            Session ID: {sessionId}
          </div>
        </div>
      </div>
    </div>
  );
}
