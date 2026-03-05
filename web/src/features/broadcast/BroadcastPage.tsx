/**
 * BroadcastPage - broadcaster interface with camera preview, controls, and participants panel
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../../config/aws-config';
import { useBroadcast } from './useBroadcast';
import { useViewerCount } from './useViewerCount';
import { CameraPreview } from './CameraPreview';
import { ChatPanel } from '../chat/ChatPanel';
import { useChatRoom } from '../chat/useChatRoom';
import { ChatRoomProvider } from '../chat/ChatRoomProvider';
import { ReactionPicker, EMOJI_MAP, type EmojiType } from '../reactions/ReactionPicker';
import { FloatingReactions, type FloatingEmoji } from '../reactions/FloatingReactions';
import { useReactionSender } from '../reactions/useReactionSender';
import { useReactionListener } from '../reactions/useReactionListener';

// ── Participants panel shown alongside the camera preview ──────────────────
function ParticipantsPanel({
  userId,
  viewerCount,
  isLive,
}: {
  userId: string;
  viewerCount: number;
  isLive: boolean;
}) {
  return (
    <div className="flex flex-col h-full bg-gray-50 border-l">
      {/* Panel header */}
      <div className="p-3 border-b bg-white">
        <h2 className="font-semibold text-gray-800 text-sm">Participants</h2>
      </div>

      {/* Broadcaster tile */}
      <div className="p-3">
        <div className="bg-gray-800 rounded-lg overflow-hidden aspect-video relative">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full bg-gray-600 flex items-center justify-center text-white text-lg font-bold">
              {userId ? userId.charAt(0).toUpperCase() : 'B'}
            </div>
          </div>
          <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
            You (Broadcaster)
          </div>
        </div>
      </div>

      {/* Viewer count */}
      <div className="px-3 pb-3">
        <div className="bg-white border rounded-lg p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
            <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <div className="text-lg font-bold text-gray-900 leading-none">{viewerCount}</div>
            <div className="text-xs text-gray-500 mt-0.5">
              {viewerCount === 1 ? 'viewer' : 'viewers'} watching
            </div>
          </div>
          {isLive && (
            <span className="ml-auto flex items-center text-xs text-red-600 font-semibold">
              <span className="w-1.5 h-1.5 bg-red-600 rounded-full mr-1.5 animate-pulse"></span>
              LIVE
            </span>
          )}
        </div>
      </div>

      {/* Publisher info */}
      <div className="px-3 pb-3">
        <div className="bg-white border rounded-lg p-3">
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Publisher</div>
          <div className="text-sm text-gray-800 font-mono truncate" title={userId}>
            {userId || '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Inner component with reactions ────────────────────────────────────────
function BroadcastContent({
  sessionId,
  userId,
  authToken,
  navigate,
}: {
  sessionId: string;
  userId: string;
  authToken: string;
  navigate: any;
}) {
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);
  const [floatingReactions, setFloatingReactions] = React.useState<FloatingEmoji[]>([]);

  const config = getConfig();
  const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

  const {
    previewRef,
    startBroadcast,
    stopBroadcast,
    toggleMute,
    toggleCamera,
    startScreenShare,
    stopScreenShare,
    isLive,
    isLoading,
    isMuted,
    isCameraOn,
    isScreenSharing,
    error,
  } = useBroadcast({
    sessionId,
    apiBaseUrl,
    authToken,
  });

  const { viewerCount } = useViewerCount({ sessionId, apiBaseUrl, isLive });
  const { room, connectionState: chatConnectionState } = useChatRoom({ sessionId, authToken });
  const { sendReaction, sending } = useReactionSender(sessionId, authToken);

  // Detect mobile
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle sending reaction
  const handleReaction = async (emoji: EmojiType) => {
    await sendReaction(emoji);
    // Optimistic UI: immediately add to floatingReactions
    setFloatingReactions((prev) => [
      ...prev,
      {
        id: uuidv4(),
        emoji: EMOJI_MAP[emoji],
        timestamp: Date.now(),
      },
    ]);
  };

  // Listen for reactions from IVS Chat
  useReactionListener(room, (reaction) => {
    const emoji = EMOJI_MAP[reaction.emojiType];
    setFloatingReactions((prev) => [
      ...prev,
      {
        id: uuidv4(),
        emoji,
        timestamp: Date.now(),
      },
    ]);
  });

  return (
    <ChatRoomProvider value={room}>
      <div className="h-screen flex flex-col bg-gray-100">
        {/* Header */}
        <div className="bg-gray-800 text-white px-4 py-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold">Broadcasting</h1>
            {isLive && (
              <span className="flex items-center text-xs bg-red-600 text-white px-2 py-0.5 rounded font-semibold">
                <span className="w-1.5 h-1.5 bg-white rounded-full mr-1.5 animate-pulse"></span>
                LIVE
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
              onClick={() => navigate('/')}
              className="px-3 py-1 text-white hover:text-gray-300 text-sm"
            >
              ← Back
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm shrink-0">
            {error}
          </div>
        )}

        {/* Main content — three-column on desktop */}
        <div className="flex-1 flex overflow-hidden">

          {/* ── Left: Camera preview + controls ── */}
          <div className={`flex flex-col ${isMobile ? 'w-full' : 'w-[50%]'} border-r bg-white overflow-y-auto`}>
            <div className="p-4 flex flex-col gap-4">
              {/* Camera preview — constrained, not full width */}
              <div className="relative">
                <CameraPreview videoRef={previewRef} />
                {/* Floating reactions overlay */}
                <FloatingReactions reactions={floatingReactions} />
              </div>

              {/* Status row */}
              <div className="flex items-center justify-between text-sm">
                <div className="text-gray-600">
                  {isLive ? (
                    <span className="flex items-center font-medium">
                      <span className="w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></span>
                      Live · {viewerCount} {viewerCount === 1 ? 'viewer' : 'viewers'}
                    </span>
                  ) : (
                    <span className="text-gray-400">Ready to go live</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 font-mono truncate max-w-[40%]" title={sessionId}>
                  {sessionId.slice(0, 12)}…
                </div>
              </div>

              {/* Controls bar */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Live controls — only shown when broadcasting */}
                {isLive && (
                  <>
                    <button
                      onClick={toggleMute}
                      title={isMuted ? 'Unmute' : 'Mute'}
                      className={`px-3 py-2 rounded-lg font-semibold text-sm ${
                        isMuted
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                      }`}
                    >
                      {isMuted ? '🔇 Unmute' : '🎙 Mute'}
                    </button>

                    <button
                      onClick={toggleCamera}
                      title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
                      className={`px-3 py-2 rounded-lg font-semibold text-sm ${
                        !isCameraOn
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                      }`}
                    >
                      {isCameraOn ? '📷 Camera' : '📷 Off'}
                    </button>

                    <button
                      onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                      title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                      className={`px-3 py-2 rounded-lg font-semibold text-sm ${
                        isScreenSharing
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                      }`}
                    >
                      {isScreenSharing ? '🖥 Stop Share' : '🖥 Share'}
                    </button>

                    <ReactionPicker
                      onReaction={handleReaction}
                      disabled={sending}
                    />
                  </>
                )}

                {/* Go live / Stop button — always shown */}
                <div className="ml-auto">
                  {!isLive ? (
                    <button
                      onClick={startBroadcast}
                      disabled={isLoading}
                      className="px-5 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {isLoading ? 'Starting…' : 'Go Live'}
                    </button>
                  ) : (
                    <button
                      onClick={stopBroadcast}
                      className="px-5 py-2 bg-gray-800 text-white rounded-lg font-semibold hover:bg-gray-900 text-sm"
                    >
                      Stop Broadcast
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Middle: Participants panel (desktop only) ── */}
          {!isMobile && (
            <div className="w-[20%] border-r overflow-y-auto">
              <ParticipantsPanel
                userId={userId}
                viewerCount={viewerCount}
                isLive={isLive}
              />
            </div>
          )}

          {/* ── Right: Chat (desktop only) ── */}
          {!isMobile && (
            <div className="w-[30%]">
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
      </div>
    </ChatRoomProvider>
  );
}

export function BroadcastPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [authToken, setAuthToken] = React.useState<string>('');
  const [userId, setUserId] = React.useState<string>('');

  // Get userId and auth token from Cognito session
  React.useEffect(() => {
    const getSession = async () => {
      try {
        const session = await fetchAuthSession();
        const sub = session.tokens?.idToken?.payload?.sub as string;
        if (sub) {
          setUserId(sub);
        }
        setAuthToken(session.tokens?.idToken?.toString() || '');
      } catch (error) {
        console.error('Failed to get user ID:', error);
      }
    };
    getSession();
  }, []);

  if (!sessionId) {
    return <div className="p-8 text-red-600">Session ID required</div>;
  }

  if (!userId) {
    return <div className="p-8">Loading…</div>;
  }

  return (
    <BroadcastContent
      sessionId={sessionId}
      userId={userId}
      authToken={authToken}
      navigate={navigate}
    />
  );
}
