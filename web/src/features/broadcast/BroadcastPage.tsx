/**
 * BroadcastPage - broadcaster interface with camera preview and go live controls
 */

import { useParams, useNavigate } from 'react-router-dom';
import { useBroadcast } from './useBroadcast';
import { CameraPreview } from './CameraPreview';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export function BroadcastPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const authToken = localStorage.getItem('token') || '';

  if (!sessionId) {
    return <div className="p-8 text-red-600">Session ID required</div>;
  }

  const { previewRef, startBroadcast, stopBroadcast, isLive, isLoading, error } = useBroadcast({
    sessionId,
    apiBaseUrl: API_BASE_URL,
    authToken,
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Broadcast</h1>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-gray-700 hover:text-gray-900"
          >
            ← Back
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-md p-6">
          <CameraPreview videoRef={previewRef} />

          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {isLive ? (
                <span className="flex items-center">
                  <span className="w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></span>
                  LIVE
                </span>
              ) : (
                <span>Ready to go live</span>
              )}
            </div>

            {!isLive ? (
              <button
                onClick={startBroadcast}
                disabled={isLoading}
                className="px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Starting...' : 'Go Live'}
              </button>
            ) : (
              <button
                onClick={stopBroadcast}
                className="px-6 py-3 bg-gray-800 text-white rounded-lg font-semibold hover:bg-gray-900"
              >
                Stop Broadcast
              </button>
            )}
          </div>

          <div className="mt-4 text-xs text-gray-500">
            Session ID: {sessionId}
          </div>
        </div>
      </div>
    </div>
  );
}
