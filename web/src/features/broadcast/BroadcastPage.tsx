/**
 * BroadcastPage - broadcaster interface with camera preview, controls, and participants panel
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchToken } from '../../auth/fetchToken';
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
import { StreamQualityOverlay } from './StreamQualityOverlay';
import { useStreamMetrics } from './useStreamMetrics';
import { SpotlightBadge } from '../spotlight/SpotlightBadge';
import { SpotlightModal } from '../spotlight/SpotlightModal';
import { useSpotlight } from '../spotlight/useSpotlight';
import { ConfirmModal } from '../../components/social';
import { Card, Avatar } from '../../components/social';

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
    <Card className="flex flex-col h-full rounded-none border-l">
      {/* Panel header */}
      <Card.Header>
        <h2 className="font-semibold text-gray-800 text-sm">Participants</h2>
      </Card.Header>

      {/* Broadcaster tile */}
      <Card.Body>
        <div className="bg-gray-800 rounded-lg overflow-hidden aspect-video relative">
          <div className="absolute inset-0 flex items-center justify-center">
            <Avatar name={userId} alt={userId || 'Broadcaster'} size="lg" />
          </div>
          <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
            You (Broadcaster)
          </div>
        </div>
      </Card.Body>

      {/* Viewer count */}
      <div className="px-3 pb-3">
        <Card className="p-3 flex items-center gap-3">
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
            <span className="ml-auto inline-flex items-center text-xs bg-red-600/10 text-red-600 font-bold px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-red-600 rounded-full mr-1.5 animate-pulse"></span>
              LIVE
            </span>
          )}
        </Card>
      </div>

      {/* Publisher info */}
      <div className="px-3 pb-3">
        <Card className="p-3">
          <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-1">Publisher</div>
          <div className="text-sm text-gray-800 font-mono truncate" title={userId}>
            {userId || '—'}
          </div>
        </Card>
      </div>
    </Card>
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
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [showStopConfirm, setShowStopConfirm] = React.useState(false);

  const viewerUrl = `${window.location.origin}/viewer/${sessionId}`;

  const copyViewerLink = async () => {
    try {
      await navigator.clipboard.writeText(viewerUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS contexts
      const input = document.createElement('input');
      input.value = viewerUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const config = getConfig();
  const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

  const {
    client,
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

  // NEW: Add metrics hook
  const { metrics, healthScore } = useStreamMetrics(client, isLive);

  // Spotlight hook
  const {
    featuredCreator,
    liveSessions,
    isLoadingLive,
    isModalOpen,
    openModal,
    closeModal,
    selectCreator,
    removeCreator,
    refreshLiveSessions,
  } = useSpotlight({ sessionId, authToken, isLive });
  const { room, connectionState: chatConnectionState, error: chatError } = useChatRoom({ sessionId, authToken });
  const { sendReaction, sending } = useReactionSender(sessionId, authToken);

  // Detect mobile
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle sending reaction
  const handleReaction = async (emoji: EmojiType) => {
    try {
      await sendReaction(emoji);
    } catch (err) {
      console.error('Failed to send reaction:', err);
    }
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
        <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold">Broadcasting</h1>
            {isLive && (
              <span className="inline-flex items-center text-xs bg-red-600 text-white px-2.5 py-1 rounded-full font-bold tracking-wide shadow-lg shadow-red-600/30 animate-live-pulse">
                <span className="w-2 h-2 bg-white rounded-full mr-1.5"></span>
                LIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyViewerLink}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                linkCopied
                  ? 'bg-green-500 text-white scale-105'
                  : 'bg-white/15 text-white hover:bg-white/25 active:bg-white/35'
              }`}
              title={viewerUrl}
            >
              {linkCopied ? 'Copied!' : 'Copy Link'}
            </button>
            {isMobile && (
              <button
                onClick={() => setIsChatOpen(!isChatOpen)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded-lg text-sm font-medium transition-colors duration-150"
              >
                Chat
              </button>
            )}
            <button
              onClick={() => navigate('/')}
              className="px-3 py-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg text-sm transition-all duration-150"
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
          <Card className={`flex flex-col ${isMobile ? 'w-full' : 'w-[50%]'} border-r rounded-none overflow-y-auto`}>
            <Card.Body className="flex flex-col gap-4">
              {/* Camera preview — constrained, not full width */}
              <div className="relative">
                <CameraPreview videoRef={previewRef} />
                {/* Floating reactions overlay */}
                <FloatingReactions reactions={floatingReactions} />
                {/* NEW: Stream quality dashboard overlay */}
                <StreamQualityOverlay
                  metrics={metrics}
                  healthScore={healthScore}
                  isLive={isLive}
                />
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
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap animate-slide-up">
                {/* Live controls — only shown when broadcasting */}
                {isLive && (
                  <>
                    <button
                      onClick={toggleMute}
                      title={isMuted ? 'Unmute' : 'Mute'}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${
                        isMuted
                          ? 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm shadow-red-600/25'
                          : 'bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        {isMuted ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 19L5 5m14 0l-3.5 3.5M12 18.75a6 6 0 01-6-6v-1.5m6 7.5a6 6 0 006-6v-1.5M12 18.75V21m-4.5 0h9M9.75 3.104A4.5 4.5 0 0112 2.25a4.5 4.5 0 014.5 4.5v4.5" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                        )}
                      </svg>
                      {isMuted ? 'Unmute' : 'Mute'}
                    </button>

                    <button
                      onClick={toggleCamera}
                      title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${
                        !isCameraOn
                          ? 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm shadow-red-600/25'
                          : 'bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        {!isCameraOn ? (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25zM3 3l18 18" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                        )}
                      </svg>
                      {isCameraOn ? 'Camera' : 'Off'}
                    </button>

                    <button
                      onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                      title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${
                        isScreenSharing
                          ? 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm shadow-blue-600/25'
                          : 'bg-gray-200 text-gray-800 hover:bg-gray-300 active:bg-gray-400'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
                      </svg>
                      {isScreenSharing ? 'Stop Share' : 'Share'}
                    </button>

                    <ReactionPicker
                      onReaction={handleReaction}
                      disabled={sending}
                    />

                    <button
                      onClick={openModal}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold text-sm bg-purple-600 text-white hover:bg-purple-700 active:bg-purple-800 shadow-sm hover:shadow-md transition-all duration-200"
                    >
                      {featuredCreator ? 'Change Spotlight' : 'Feature Creator'}
                    </button>
                  </>
                )}

                {/* Go live / Stop button — always shown */}
                <div className="ml-auto">
                  {!isLive ? (
                    <button
                      onClick={startBroadcast}
                      disabled={isLoading}
                      className="px-5 py-2 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 active:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-md hover:shadow-lg transition-all duration-200"
                    >
                      {isLoading ? 'Starting…' : 'Go Live'}
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowStopConfirm(true)}
                      className="px-5 py-2 bg-gray-800 text-white rounded-lg font-semibold hover:bg-gray-900 active:bg-black text-sm shadow-sm hover:shadow-md transition-all duration-200"
                    >
                      Stop Broadcast
                    </button>
                  )}
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Spotlight badge — shown when broadcaster has featured a creator */}
          {featuredCreator && (
            <SpotlightBadge
              featuredCreator={featuredCreator}
              onRemove={removeCreator}
              isBroadcaster={true}
            />
          )}

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
            <Card className="w-[30%] flex flex-col rounded-none overflow-hidden">
              <Card.Header>Chat</Card.Header>
              <Card.Body className="flex-1 overflow-hidden p-0">
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
              </Card.Body>
            </Card>
          )}
        </div>

        {/* Mobile chat overlay */}
        {isMobile && (
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

        {/* Spotlight modal — portal-based, renders into document.body */}
        <SpotlightModal
          isOpen={isModalOpen}
          onClose={closeModal}
          liveSessions={liveSessions}
          isLoading={isLoadingLive}
          onSelect={selectCreator}
          onRefresh={refreshLiveSessions}
        />

        <ConfirmModal
          isOpen={showStopConfirm}
          title="Stop broadcast?"
          message="Your stream will end and viewers will be disconnected."
          confirmLabel="Stop"
          variant="danger"
          onConfirm={() => { stopBroadcast(); setShowStopConfirm(false); }}
          onClose={() => setShowStopConfirm(false)}
        />
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
        const { token, username } = await fetchToken();
        if (username) setUserId(username);
        setAuthToken(token);
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
