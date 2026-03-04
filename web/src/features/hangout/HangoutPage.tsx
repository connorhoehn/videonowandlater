/**
 * HangoutPage - main hangout interface with video grid, controls, and chat
 * Mirrors BroadcastPage.tsx structure for consistency
 */

import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { useHangout } from './useHangout';
import { useActiveSpeaker } from './useActiveSpeaker';
import { VideoGrid } from './VideoGrid';
import { ChatPanel } from '../chat/ChatPanel';
import { ChatRoomProvider } from '../chat/ChatRoomProvider';
import { useChatRoom } from '../chat/useChatRoom';
import { getConfig } from '../../config/aws-config';

export function HangoutPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [authToken, setAuthToken] = useState('');

  React.useEffect(() => {
    fetchAuthSession().then(session => {
      setAuthToken(session.tokens?.idToken?.toString() || '');
    });
  }, []);

  // Get userId from localStorage (set during auth)
  const [userId, setUserId] = useState<string>('');

  React.useEffect(() => {
    // In a real app, get from Cognito session like BroadcastPage
    // For now, use a placeholder
    const storedUserId = localStorage.getItem('userId') || 'user-' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('userId', storedUserId);
    setUserId(storedUserId);
  }, []);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  const config = getConfig();
  const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

  const {
    localVideoRef,
    participants,
    isJoined,
    error,
    toggleMute,
    toggleCamera,
  } = useHangout({
    sessionId: sessionId || '',
    apiBaseUrl,
    authToken,
  });

  const { activeSpeakerId } = useActiveSpeaker({ participants });
  const { room, connectionState: chatConnectionState } = useChatRoom({ sessionId: sessionId || '', authToken });

  // Merge activeSpeakerId into participants array
  const participantsWithSpeaking = useMemo(
    () =>
      participants.map((p) => ({
        ...p,
        isSpeaking: p.participantId === activeSpeakerId,
      })),
    [participants, activeSpeakerId]
  );

  // Detect mobile
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMuteToggle = () => {
    toggleMute(!isMuted);
    setIsMuted(!isMuted);
  };

  const handleCameraToggle = () => {
    toggleCamera(!isCameraOn);
    setIsCameraOn(!isCameraOn);
  };

  const handleLeave = () => {
    navigate('/');
  };

  if (!sessionId) {
    return <div className="p-8 text-red-600">Session ID required</div>;
  }

  if (!userId) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <ChatRoomProvider value={room}>
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
        <h1 className="text-xl font-bold">Hangout Session {sessionId}</h1>
        <button
          onClick={handleLeave}
          className="px-3 py-1 text-white hover:text-gray-300"
        >
          ← Leave
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
        <div className="p-4 bg-red-50 border-b border-red-200 text-red-700">
          {error}
        </div>
      )}

      {!isJoined && (
        <div className="p-8 text-center">
          <div className="text-lg">Joining hangout...</div>
        </div>
      )}

      {isJoined && (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Video section */}
          <div className="w-full md:w-2/3 flex flex-col">
            <div className="flex-1 overflow-hidden">
              <VideoGrid participants={participantsWithSpeaking} />
            </div>

            {/* Controls */}
            <div className="p-4 bg-gray-100 border-t flex justify-center gap-4">
              <button
                onClick={handleMuteToggle}
                className={`px-6 py-3 rounded-lg font-semibold ${
                  isMuted
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-800 text-white hover:bg-gray-900'
                }`}
              >
                {isMuted ? 'Unmute' : 'Mute'}
              </button>
              <button
                onClick={handleCameraToggle}
                className={`px-6 py-3 rounded-lg font-semibold ${
                  !isCameraOn
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-800 text-white hover:bg-gray-900'
                }`}
              >
                {isCameraOn ? 'Camera Off' : 'Camera On'}
              </button>
            </div>
          </div>

          {/* Chat section - Desktop */}
          {!isMobile && (
            <div className="w-full md:w-1/3">
              <ChatPanel
                sessionId={sessionId}
                sessionOwnerId={userId}
                authToken={authToken}
                isMobile={false}
                isOpen={true}
                connectionState={chatConnectionState}
              />
            </div>
          )}
        </div>
      )}

      {/* Mobile chat overlay */}
      {isMobile && (
        <ChatPanel
          sessionId={sessionId}
          sessionOwnerId={userId}
          authToken={authToken}
          isMobile={true}
          isOpen={isChatOpen}
          connectionState={chatConnectionState}
          onClose={() => setIsChatOpen(false)}
        />
      )}

      {/* Local video preview (hidden - used by useHangout) */}
      <video ref={localVideoRef} style={{ display: 'none' }} autoPlay muted />
    </div>
    </ChatRoomProvider>
  );
}
