/**
 * HangoutPage - main hangout interface with video grid, controls, and chat
 * Mirrors BroadcastPage.tsx structure for consistency
 */

import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchToken } from '../../auth/fetchToken';
import { v4 as uuidv4 } from 'uuid';
import { useHangout } from './useHangout';
import { useActiveSpeaker } from './useActiveSpeaker';
import { VideoGrid } from './VideoGrid';
import { ChatPanel } from '../chat/ChatPanel';
import { ChatRoomProvider } from '../chat/ChatRoomProvider';
import { useChatRoom } from '../chat/useChatRoom';
import { getConfig } from '../../config/aws-config';
import { ReactionPicker, EMOJI_MAP, type EmojiType } from '../reactions/ReactionPicker';
import { FloatingReactions, type FloatingEmoji } from '../reactions/FloatingReactions';
import { useReactionSender } from '../reactions/useReactionSender';
import { useReactionListener } from '../reactions/useReactionListener';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function HangoutPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  // Auth state — fetched from Cognito (same pattern as BroadcastPage)
  const [authToken, setAuthToken] = useState('');
  const [userId, setUserId] = useState<string>('');

  React.useEffect(() => {
    fetchToken().then(({ token, username }) => {
      if (username) setUserId(username);
      setAuthToken(token);
    }).catch(err => {
      console.error('Failed to get auth session:', err);
    });
  }, []);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingEmoji[]>([]);

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
  const { room, connectionState: chatConnectionState, error: chatError } = useChatRoom({ sessionId: sessionId || '', authToken });
  const { sendReaction } = useReactionSender(sessionId || '', authToken);

  useReactionListener(room, (reaction) => {
    const emoji = EMOJI_MAP[reaction.emojiType as EmojiType];
    setFloatingReactions(prev => [...prev, { id: uuidv4(), emoji, timestamp: Date.now() }]);
  });

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

  const handleReaction = async (emoji: EmojiType) => {
    await sendReaction(emoji);
    setFloatingReactions(prev => [...prev, { id: uuidv4(), emoji: EMOJI_MAP[emoji], timestamp: Date.now() }]);
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
      <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">Hangout</h1>
          {isJoined && (
            <span className="inline-flex items-center text-xs bg-green-500/15 text-green-400 font-semibold px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full mr-1.5 animate-pulse"></span>
              {participants.length} {participants.length === 1 ? 'participant' : 'participants'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isMobile && (
            <button
              onClick={() => setIsChatOpen(!isChatOpen)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-lg text-sm font-medium transition-colors duration-150"
            >
              Chat
            </button>
          )}
          <button
            onClick={() => setShowLeaveConfirm(true)}
            className="px-3 py-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg text-sm transition-all duration-150"
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
          <div className="w-full md:w-2/3 flex flex-col relative">
            <div className="flex-1 overflow-hidden">
              <VideoGrid participants={participantsWithSpeaking} />
            </div>
            <FloatingReactions
              reactions={floatingReactions}
              onExpire={(id) => setFloatingReactions(prev => prev.filter(r => r.id !== id))}
            />

            {/* Controls */}
            <div className="px-4 py-3 sm:py-4 bg-gray-900/95 backdrop-blur-md border-t border-gray-700/50 flex justify-center gap-2 sm:gap-3 shrink-0 animate-slide-up">
              <button
                onClick={handleMuteToggle}
                title={isMuted ? 'Unmute' : 'Mute'}
                className={`inline-flex items-center justify-center w-12 h-12 sm:w-auto sm:h-auto sm:gap-2 sm:px-5 sm:py-3 rounded-full sm:rounded-xl font-semibold text-sm transition-all duration-200 ${
                  isMuted
                    ? 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-lg shadow-red-600/30'
                    : 'bg-white/15 text-white hover:bg-white/25 active:bg-white/35'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  {isMuted ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 19L5 5m14 0l-3.5 3.5M12 18.75a6 6 0 01-6-6v-1.5m6 7.5a6 6 0 006-6v-1.5M12 18.75V21m-4.5 0h9M9.75 3.104A4.5 4.5 0 0112 2.25a4.5 4.5 0 014.5 4.5v4.5" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  )}
                </svg>
                <span className="hidden sm:inline">{isMuted ? 'Unmute' : 'Mute'}</span>
              </button>
              <button
                onClick={handleCameraToggle}
                title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
                className={`inline-flex items-center justify-center w-12 h-12 sm:w-auto sm:h-auto sm:gap-2 sm:px-5 sm:py-3 rounded-full sm:rounded-xl font-semibold text-sm transition-all duration-200 ${
                  !isCameraOn
                    ? 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-lg shadow-red-600/30'
                    : 'bg-white/15 text-white hover:bg-white/25 active:bg-white/35'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  {!isCameraOn ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25zM3 3l18 18" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  )}
                </svg>
                <span className="hidden sm:inline">{isCameraOn ? 'Camera' : 'Cam Off'}</span>
              </button>
              {isJoined && (
                <ReactionPicker onReaction={handleReaction} />
              )}
              <button
                onClick={() => setShowLeaveConfirm(true)}
                className="inline-flex items-center justify-center w-12 h-12 sm:w-auto sm:h-auto sm:gap-2 sm:px-5 sm:py-3 rounded-full sm:rounded-xl font-semibold text-sm bg-white/10 text-red-400 hover:bg-red-600 hover:text-white active:bg-red-700 transition-all duration-200"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
                <span className="hidden sm:inline">Leave</span>
              </button>
            </div>
          </div>

          {/* Chat section - Desktop */}
          {!isMobile && userId && (
            <div className="w-full md:w-1/3">
              <ChatPanel
                sessionId={sessionId}
                sessionOwnerId={userId}
                currentUserId={userId}
                authToken={authToken}
                isMobile={false}
                isOpen={true}
                connectionState={chatConnectionState}
                chatError={chatError}
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
          currentUserId={userId}
          authToken={authToken}
          isMobile={true}
          isOpen={isChatOpen}
          connectionState={chatConnectionState}
          onClose={() => setIsChatOpen(false)}
          chatError={chatError}
        />
      )}

      {/* Local video preview (hidden - used by useHangout) */}
      <video ref={localVideoRef} style={{ display: 'none' }} autoPlay muted playsInline />
    </div>

    <ConfirmDialog
      isOpen={showLeaveConfirm}
      title="Leave hangout?"
      message="You will be disconnected from the session."
      confirmLabel="Leave"
      onConfirm={() => { handleLeave(); setShowLeaveConfirm(false); }}
      onCancel={() => setShowLeaveConfirm(false)}
    />
    </ChatRoomProvider>
  );
}
