/**
 * ViewerPage - viewer interface for watching live broadcasts
 */

import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchToken } from '../../auth/fetchToken';
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
import { useSessionKillListener } from '../chat/useSessionKillListener';
import { useUserKickListener, type UserKickedEvent } from '../chat/useUserKickListener';
import { SpotlightBadge } from '../spotlight/SpotlightBadge';
import { Card, Avatar, useToast } from '../../components/social';
import { AdOverlay } from '../ads/AdOverlay';
import { TrainingOverlay } from '../training/TrainingOverlay';
import { CaptionsOverlay } from '../captions/CaptionsOverlay';

export function ViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [authToken, setAuthToken] = React.useState('');
  const [userId, setUserId] = React.useState('');

  React.useEffect(() => {
    fetchToken().then(({ token, username }) => {
      if (username) setUserId(username);
      setAuthToken(token);
    }).catch(err => {
      console.error('Failed to get auth session:', err);
    });
  }, []);

  const [session, setSession] = React.useState<any>(null);
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(window.innerWidth < 768);
  const [floatingReactions, setFloatingReactions] = React.useState<FloatingEmoji[]>([]);
  const [killError, setKillError] = React.useState<string | null>(null);

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

  // Poll session data every 15s when live to keep featured creator info fresh
  React.useEffect(() => {
    if (!authToken || !sessionId || session?.status !== 'live') return;

    const config = getConfig();
    const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (response.ok) {
          const data = await response.json();
          setSession(data);
        }
      } catch { /* ignore polling errors */ }
    }, 15000);

    return () => clearInterval(interval);
  }, [authToken, sessionId, session?.status]);

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

  const { videoRef, player, isPlaying, isMuted, toggleMute, sessionStatus, error } = usePlayer({
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

  useSessionKillListener(room, React.useCallback((reason: string) => {
    setKillError(`Session ended: ${reason}`);
    setTimeout(() => navigate('/'), 3000);
  }, [navigate]));

  const { addToast } = useToast();
  useUserKickListener({
    room,
    currentUserId: userId,
    onSelfKicked: React.useCallback((e: UserKickedEvent) => {
      const scopeLabel = e.scope === 'global' ? 'globally banned' : 'removed from this chat';
      setKillError(`You have been ${scopeLabel}: ${e.reason}`);
      setTimeout(() => navigate('/'), 3000);
    }, [navigate]),
    onOtherKicked: React.useCallback((e: UserKickedEvent) => {
      addToast({
        variant: 'info',
        title: e.scope === 'global' ? 'User globally banned' : 'User removed from chat',
        description: `${e.userId}: ${e.reason}`,
      });
    }, [addToast]),
  });

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
      <div className="bg-gray-900 text-white px-4 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">Watch Live</h1>
          {isPlaying && (
            <span className="inline-flex items-center text-xs bg-red-600 text-white px-2.5 py-1 rounded-full font-bold tracking-wide shadow-lg shadow-red-600/30 animate-live-pulse">
              <span className="w-2 h-2 bg-white rounded-full mr-1.5"></span>
              LIVE
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
            onClick={() => navigate('/')}
            className="px-3 py-1.5 text-white/70 hover:text-white hover:bg-white/10 rounded-lg text-sm transition-all duration-150"
          >
            ← Back
          </button>
        </div>
      </div>

      {killError && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-red-700 text-sm shrink-0">
          {killError}
        </div>
      )}

      {error && !killError && (
        <div className="px-4 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-700 text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video section */}
        <div className={isMobile ? 'w-full flex flex-col' : 'w-[70%] border-r flex flex-col'}>
          <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
            {/* Video player card with reactions overlay */}
            <Card className="overflow-visible">
              <Card.Body className="p-0">
                <div className="relative">
                  <VideoPlayer videoRef={videoRef} isPlaying={isPlaying} isMuted={isMuted} onToggleMute={toggleMute} />
                  {/* Floating reactions overlay */}
                  <FloatingReactions reactions={floatingReactions} />
                  {/* Ad overlay — BROADCAST path: subscribes to IVS Player TEXT_METADATA_CUE */}
                  <AdOverlay sessionId={sessionId} isBroadcast={true} player={player} />
                  <TrainingOverlay sessionId={sessionId} />
                  {/* Live captions overlay — hidden until host enables captions. */}
                  {sessionId && (
                    <CaptionsOverlay
                      room={room}
                      initialEnabled={Boolean(session?.captionsEnabled)}
                      sessionId={sessionId}
                    />
                  )}
                </div>
              </Card.Body>
            </Card>

            {/* Broadcaster info card */}
            <Card>
              <Card.Body className="py-2">
                <div className="flex items-center justify-between text-sm gap-3">
                  <div className="flex items-center gap-3 flex-1 flex-wrap">
                    {session?.userId && (
                      <div className="flex items-center gap-2 text-gray-700">
                        <Avatar
                          alt={session.userId}
                          name={session.userId}
                          size="sm"
                        />
                        <span className="font-medium">Broadcaster</span>
                        <span className="text-gray-400 font-mono text-xs hidden sm:inline" title={session.userId}>
                          {session.userId.slice(0, 8)}…
                        </span>
                      </div>
                    )}
                    {sessionStatus && (
                      <span className="text-xs text-gray-500 bg-gray-100 border border-gray-200 px-2.5 py-0.5 rounded-full font-medium">
                        {sessionStatus}
                      </span>
                    )}
                    {/* Featured creator link — shown when broadcaster has spotlighted a creator */}
                    {session?.featuredCreatorId && (
                      <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-3 py-1.5">
                        <span className="w-2 h-2 bg-green-500 rounded-full shrink-0" />
                        <span className="text-sm text-purple-800 font-medium">Featured:</span>
                        <Link
                          to={`/viewer/${session.featuredCreatorId}`}
                          className="text-sm text-purple-600 hover:text-purple-800 font-medium underline"
                        >
                          {session.featuredCreatorName || 'Creator'}
                        </Link>
                      </div>
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
              </Card.Body>
            </Card>

            {/* Read-only SpotlightBadge for viewers — fixed at top-right */}
            {session?.featuredCreatorId && session?.featuredCreatorName && (
              <SpotlightBadge
                featuredCreator={{ sessionId: session.featuredCreatorId, name: session.featuredCreatorName }}
                isBroadcaster={false}
              />
            )}
          </div>
        </div>

        {/* Chat section - Desktop */}
        {!isMobile && (
          <div className="w-[30%] flex flex-col">
            <Card className="flex-1 flex flex-col rounded-none">
              <Card.Header>
                <span className="font-semibold text-sm text-gray-700">Live Chat</span>
                {chatConnectionState && (
                  <span className="text-xs text-gray-400">{chatConnectionState}</span>
                )}
              </Card.Header>
              <Card.Body className="flex-1 p-0 overflow-hidden">
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
              </Card.Body>
            </Card>
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
