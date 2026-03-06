/**
 * ViewerPage - viewer interface for watching live broadcasts
 */

import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../../config/aws-config';
import { usePlayer } from './usePlayer';
import { VideoPlayer } from './VideoPlayer';
import { ChatPanel } from '../chat/ChatPanel';
import { useChatRoom } from '../chat/useChatRoom';
import { ChatRoomProvider } from '../chat/ChatRoomProvider';
import { ReactionPicker, EMOJI_MAP, type EmojiType } from '../reactions/ReactionPicker';
import { FloatingReactions, type FloatingEmoji } from '../reactions/FloatingReactions';
import { useReactionSender } from '../reactions/useReactionSender';
import { useReactionListener } from '../reactions/useReactionListener';

export function ViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [authToken, setAuthToken] = React.useState('');
  const [userId, setUserId] = React.useState('');

  React.useEffect(() => {
    fetchAuthSession().then(session => {
      const username = session.tokens?.idToken?.payload?.['cognito:username'] as string | undefined;
      if (username) setUserId(username);
      setAuthToken(session.tokens?.idToken?.toString() || '');
    }).catch(err => {
      console.error('Failed to get auth session:', err);
    });
  }, []);

  const [session, setSession] = React.useState<any>(null);
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);
  const [floatingReactions, setFloatingReactions] = React.useState<FloatingEmoji[]>([]);

  // Fetch session data to get sessionOwnerId — guard against empty authToken
  React.useEffect(() => {
    if (!authToken || !sessionId) return;

    const config = getConfig();
    const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

    const fetchSession = async () => {
      setSessionLoading(true);
      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!response.ok) {
          console.error('Failed to fetch session:', response.status, response.statusText);
          return;
        }
        const data = await response.json();
        setSession(data);
      } catch (error) {
        console.error('Failed to fetch session:', error);
      } finally {
        setSessionLoading(false);
      }
    };

    fetchSession();
  }, [sessionId, authToken]);

  // Detect mobile
  React.useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { room, connectionState: chatConnectionState } = useChatRoom({ sessionId: sessionId ?? '', authToken });

  if (!sessionId) {
    return <div className="p-8 text-red-600">Session ID required</div>;
  }

  const config = getConfig();
  const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

  const { videoRef, isPlaying, sessionStatus, error } = usePlayer({
    sessionId,
    apiBaseUrl,
  });

  const { sendReaction, sending } = useReactionSender(sessionId ?? '', authToken);

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

  // The session owner (broadcaster) ID — used for chat ownership display
  const sessionOwnerId = session?.userId ?? userId;

  return (
    <ChatRoomProvider value={room}>
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">Watch Live</h1>
          {isPlaying && (
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
        <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-700 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video section */}
        <div className={isMobile ? 'w-full flex flex-col' : 'w-[70%] border-r flex flex-col'}>
          <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
            {/* Video player with reactions overlay */}
            <div className="relative">
              <VideoPlayer videoRef={videoRef} isPlaying={isPlaying} />
              {/* Floating reactions overlay */}
              <FloatingReactions reactions={floatingReactions} />
            </div>

            {/* Broadcaster info + status row + reaction picker */}
            <div className="flex items-center justify-between text-sm gap-3">
              <div className="flex items-center gap-3 flex-1">
                {session?.userId && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center text-xs font-bold text-gray-700">
                      {session.userId.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium">Broadcaster</span>
                    <span className="text-gray-400 font-mono text-xs hidden sm:inline" title={session.userId}>
                      {session.userId.slice(0, 8)}…
                    </span>
                  </div>
                )}
                {sessionStatus && (
                  <span className="text-xs text-gray-400 border border-gray-200 px-2 py-0.5 rounded">
                    {sessionStatus}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <ReactionPicker
                  onReaction={handleReaction}
                  disabled={sending}
                />
                <div className="text-xs text-gray-400 font-mono hidden sm:block" title={sessionId}>
                  {sessionId.slice(0, 12)}…
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chat section - Desktop */}
        {!isMobile && (
          <div className="w-[30%]">
            {/* Show chat once we have session data or auth; fall back to current userId as owner */}
            {!sessionLoading ? (
              <ChatPanel
                sessionId={sessionId}
                sessionOwnerId={sessionOwnerId}
                authToken={authToken}
                isMobile={false}
                isOpen={true}
                connectionState={chatConnectionState}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                Loading chat…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile chat overlay */}
      {isMobile && (
        <ChatPanel
          sessionId={sessionId}
          sessionOwnerId={sessionOwnerId}
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
