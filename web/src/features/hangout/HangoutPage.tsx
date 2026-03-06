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

  // Auth state — fetched from Cognito (same pattern as BroadcastPage)
  const [authToken, setAuthToken] = useState('');
  const [userId, setUserId] = useState<string>('');

  React.useEffect(() => {
    fetchAuthSession().then(session => {
      const username = session.tokens?.idToken?.payload?.['cognito:username'] as string | undefined;
      if (username) setUserId(username);
      setAuthToken(session.tokens?.idToken?.toString() || '');
    }).catch(err => {
      console.error('Failed to get auth session:', err);
    });
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

  // End session via API — only when this user is the last participant
  const endSession = React.useCallback(() => {
    if (!authToken || !sessionId) return;
    if (participants.length > 1) return;
    const config = getConfig();
    if (!config?.apiUrl) return;
    fetch(`${config.apiUrl}/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      keepalive: true,
    }).catch(() => {});
  }, [authToken, sessionId, participants]);

  // End session when tab is closed or user navigates away
  React.useEffect(() => {
    window.addEventListener('pagehide', endSession);
    return () => window.removeEventListener('pagehide', endSession);
  }, [endSession]);

  const handleLeave = () => {
    endSession();
    navigate('/');
  };

  if (!sessionId) {
    return <div className="p-8 text-red-600">Session ID required</div>;
  }

  // Wait for Cognito to resolve before rendering (prevents race with useHangout)
  if (!userId || !authToken) {
    return <div className="p-8">Loading…</div>;
  }

  return (
    <ChatRoomProvider value={room}>
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 text-white p-4 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Hangout</h1>
          {isJoined && (
            <span className="text-xs text-green-400 font-medium">
              {participants.length} {participants.length === 1 ? 'participant' : 'participants'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isMobile && (
            <button
              onClick={() => setIsChatOpen(!isChatOpen)}
              className="px-3 py-1 bg-blue-600 rounded text-sm"
            >
              Chat
            </button>
          )}
          <button
            onClick={handleLeave}
            className="px-3 py-1 text-white hover:text-gray-300 text-sm"
          >
            ← Leave
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border-b border-red-200 text-red-700 text-sm shrink-0">
          {error}
        </div>
      )}

      {!isJoined && !error && (
        <div className="p-8 text-center text-gray-500">
          <div className="text-lg">Joining hangout…</div>
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
            <div className="p-4 bg-gray-100 border-t flex justify-center gap-4 shrink-0">
              <button
                onClick={handleMuteToggle}
                className={`px-6 py-3 rounded-lg font-semibold ${
                  isMuted
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-800 text-white hover:bg-gray-900'
                }`}
              >
                {isMuted ? '🔇 Unmute' : '🎙 Mute'}
              </button>
              <button
                onClick={handleCameraToggle}
                className={`px-6 py-3 rounded-lg font-semibold ${
                  !isCameraOn
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-800 text-white hover:bg-gray-900'
                }`}
              >
                {isCameraOn ? '📷 Camera Off' : '📷 Camera On'}
              </button>
              <button
                onClick={handleLeave}
                className="px-6 py-3 rounded-lg font-semibold bg-gray-200 text-gray-800 hover:bg-gray-300"
              >
                Leave
              </button>
            </div>
          </div>

          {/* Chat section - Desktop */}
          {!isMobile && userId && (
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
      {isMobile && userId && (
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
      <video ref={localVideoRef} style={{ display: 'none' }} autoPlay muted playsInline />
    </div>
    </ChatRoomProvider>
  );
}
