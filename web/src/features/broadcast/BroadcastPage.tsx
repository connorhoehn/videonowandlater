/**
 * BroadcastPage - broadcaster interface with camera preview and go live controls
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../../config/aws-config';
import { useBroadcast } from './useBroadcast';
import { CameraPreview } from './CameraPreview';
import { ChatPanel } from '../chat/ChatPanel';
import { useChatRoom } from '../chat/useChatRoom';
import { ChatRoomProvider } from '../chat/ChatRoomProvider';
import { ReactionPicker, EMOJI_MAP, type EmojiType } from '../reactions/ReactionPicker';
import { FloatingReactions, type FloatingEmoji } from '../reactions/FloatingReactions';
import { useReactionSender } from '../reactions/useReactionSender';
import { useReactionListener } from '../reactions/useReactionListener';

// Inner component with reactions
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

  const { previewRef, startBroadcast, stopBroadcast, isLive, isLoading, error } = useBroadcast({
    sessionId,
    apiBaseUrl,
    authToken,
  });

  const { room } = useChatRoom({ sessionId, authToken });
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
      <div className="h-screen flex flex-col">
        {/* Header */}
        <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Broadcasting</h1>
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
          <div className="p-4 bg-red-50 border-b border-red-200 text-red-700">
            {error}
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Video section */}
          <div className={isMobile ? 'w-full' : 'w-[70%] border-r'}>
            <div className="h-full flex flex-col p-6 relative">
              {/* Camera preview */}
              <CameraPreview videoRef={previewRef} />

              {/* Floating reactions overlay */}
              <FloatingReactions reactions={floatingReactions} />

              {/* Controls */}
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

                <div className="flex gap-3 items-center">
                  {/* Reaction picker */}
                  <ReactionPicker
                    onReaction={handleReaction}
                    disabled={!isLive || sending}
                  />

                  {/* Go live / Stop button */}
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
              </div>

              <div className="mt-4 text-xs text-gray-500">
                Session ID: {sessionId}
              </div>
            </div>
          </div>

          {/* Chat section - Desktop */}
          {!isMobile && (
            <div className="w-[30%]">
              <ChatPanel
                sessionId={sessionId}
                sessionOwnerId={userId}
                authToken={authToken}
                isMobile={false}
                isOpen={true}
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
  const authToken = localStorage.getItem('token') || '';
  const [userId, setUserId] = React.useState<string>('');

  // Get userId from Cognito session
  React.useEffect(() => {
    const getUserId = async () => {
      try {
        const session = await fetchAuthSession();
        const sub = session.tokens?.idToken?.payload?.sub as string;
        if (sub) {
          setUserId(sub);
        }
      } catch (error) {
        console.error('Failed to get user ID:', error);
      }
    };
    getUserId();
  }, []);

  if (!sessionId) {
    return <div className="p-8 text-red-600">Session ID required</div>;
  }

  if (!userId) {
    return <div className="p-8">Loading...</div>;
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
