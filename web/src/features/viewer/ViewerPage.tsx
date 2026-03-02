/**
 * ViewerPage - viewer interface for watching live broadcasts
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePlayer } from './usePlayer';
import { VideoPlayer } from './VideoPlayer';
import { ChatPanel } from '../chat/ChatPanel';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export function ViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const authToken = localStorage.getItem('token') || '';
  const [session, setSession] = React.useState<any>(null);
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);

  // Fetch session data to get sessionOwnerId
  React.useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        const data = await response.json();
        setSession(data);
      } catch (error) {
        console.error('Failed to fetch session:', error);
      }
    };
    if (sessionId) {
      fetchSession();
    }
  }, [sessionId, authToken]);

  // Detect mobile
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (!sessionId) {
    return <div className="p-8 text-red-600">Session ID required</div>;
  }

  const { videoRef, isPlaying, sessionStatus, error } = usePlayer({
    sessionId,
    apiBaseUrl: API_BASE_URL,
  });

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Watch Live</h1>
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1 text-white hover:text-gray-300"
        >
          ← Back
        </button>
        {isMobile && (
          <button
            onClick={() => setIsChatOpen(!isChatOpen)}
            className="px-3 py-1 bg-blue-600 rounded"
          >
            Chat
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-yellow-50 border-b border-yellow-200 text-yellow-700">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video section */}
        <div className={isMobile ? 'w-full' : 'w-[70%] border-r'}>
          <div className="h-full flex flex-col p-6">
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

        {/* Chat section - Desktop */}
        {!isMobile && session?.userId && (
          <div className="w-[30%]">
            <ChatPanel
              sessionId={sessionId}
              sessionOwnerId={session.userId}
              authToken={authToken}
              isMobile={false}
              isOpen={true}
            />
          </div>
        )}
      </div>

      {/* Mobile chat overlay */}
      {isMobile && session?.userId && (
        <ChatPanel
          sessionId={sessionId}
          sessionOwnerId={session.userId}
          authToken={authToken}
          isMobile={true}
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
        />
      )}
    </div>
  );
}
