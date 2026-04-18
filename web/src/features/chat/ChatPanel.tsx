import React from 'react';
import { SendMessageRequest } from 'amazon-ivs-chat-messaging';
import { useChatRoomContext } from './ChatRoomProvider';
import { ChatMessagesProvider, useChatMessagesContext } from './ChatMessagesProvider';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { EmptyState, ChatIcon } from '../../components/social';
import { LoadingState } from './LoadingState';
import { getConfig } from '../../config/aws-config';

interface ChatPanelProps {
  sessionId: string;
  sessionOwnerId: string;
  authToken: string;
  isMobile: boolean;
  isOpen: boolean;
  connectionState: 'disconnected' | 'connecting' | 'connected';
  onClose?: () => void;
  currentUserId?: string;
  chatError?: string | null;
}

interface ConnectionIndicatorProps {
  state: string;
}

const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({ state }) => {
  if (state === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-green-600">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        Live
      </span>
    );
  }
  if (state === 'connecting') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-yellow-600">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
        Connecting
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-red-500">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      Offline
    </span>
  );
};

interface ChatPanelContentProps {
  sessionOwnerId: string;
  connectionState: string;
  onSendMessage: (content: string) => void;
  isMobile: boolean;
  onClose?: () => void;
  currentUserId?: string;
  onBounce?: (userId: string) => void;
  onReport?: (msgId: string, reportedUserId: string) => void;
  toastMsg?: string | null;
  chatError?: string | null;
}

const ChatPanelContent: React.FC<ChatPanelContentProps> = ({
  sessionOwnerId,
  connectionState,
  onSendMessage,
  isMobile,
  onClose,
  currentUserId,
  onBounce,
  onReport,
  toastMsg,
  chatError,
}) => {
  const { messages, isLoadingHistory } = useChatMessagesContext();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white/90 backdrop-blur-sm px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-800">Chat</h2>
          <ConnectionIndicator state={connectionState} />
        </div>
        {isMobile && onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 transition-colors text-sm font-medium"
          >
            Close
          </button>
        )}
      </div>

      {chatError && (
        <div className="bg-red-50 border-b border-red-200 px-3 py-2 text-sm text-red-700 text-center">
          {chatError}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        {isLoadingHistory ? (
          <LoadingState />
        ) : messages.length === 0 ? (
          <EmptyState
            title="Be the first to say hi!"
            description="Start the conversation below"
            icon={<ChatIcon className="w-8 h-8 text-gray-300" />}
            variant="compact"
          />
        ) : (
          <MessageList
            messages={messages}
            sessionOwnerId={sessionOwnerId}
            currentUserId={currentUserId}
            onBounce={onBounce}
            onReport={onReport}
          />
        )}
      </div>

      {/* Input */}
      <MessageInput
        onSendMessage={onSendMessage}
        disabled={connectionState !== 'connected'}
      />

      {/* Toast */}
      {toastMsg && (
        <div className="absolute bottom-16 left-4 right-4 bg-gray-900/90 backdrop-blur-sm text-white text-xs px-3 py-2 rounded-lg shadow-lg text-center pointer-events-none">
          {toastMsg}
        </div>
      )}
    </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  sessionId,
  sessionOwnerId,
  authToken,
  isMobile,
  isOpen,
  connectionState,
  onClose,
  currentUserId,
  chatError,
}) => {
  const room = useChatRoomContext();
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleSendMessage = async (content: string) => {
    try {
      const sent = await room.sendMessage(new SendMessageRequest(content));
      // Fire-and-forget Nova Lite chat moderation. Never block the sender on
      // classification — a failure (network, auth, etc.) must not degrade UX.
      const apiUrl = getConfig()?.apiUrl;
      if (apiUrl && authToken && sent?.id) {
        void fetch(`${apiUrl}/sessions/${sessionId}/chat/classify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ messageId: sent.id, text: content }),
        }).catch((err) => {
          // Swallow — classifier is best-effort, audit-only.
          console.warn('Chat classify call failed (non-fatal):', err);
        });
      }
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleBounce = async (targetUserId: string) => {
    if (!authToken) return;
    const apiUrl = getConfig()?.apiUrl;
    if (!apiUrl) return;
    try {
      const response = await fetch(`${apiUrl}/sessions/${sessionId}/bounce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ userId: targetUserId }),
      });
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      showToast('User bounced');
    } catch (err) {
      console.error('Failed to bounce user:', err);
    }
  };

  const handleReport = async (msgId: string, reportedUserId: string) => {
    if (!authToken) return;
    const apiUrl = getConfig()?.apiUrl;
    if (!apiUrl) return;
    try {
      const response = await fetch(`${apiUrl}/sessions/${sessionId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ msgId, reportedUserId }),
      });
      if (!response.ok) throw new Error(`Failed: ${response.status}`);
      showToast('Message reported');
    } catch (err) {
      console.error('Failed to report message:', err);
    }
  };

  const overlayClasses = isMobile
    ? `fixed inset-0 z-50 bg-white transform transition-transform duration-300 ease-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`
    : 'w-full h-full bg-white/95 backdrop-blur-sm';

  return (
    <ChatMessagesProvider sessionId={sessionId} authToken={authToken}>
      <div className={overlayClasses}>
        <ChatPanelContent
          sessionOwnerId={sessionOwnerId}
          connectionState={connectionState}
          onSendMessage={handleSendMessage}
          isMobile={isMobile}
          onClose={onClose}
          currentUserId={currentUserId}
          onBounce={handleBounce}
          onReport={handleReport}
          toastMsg={toastMsg}
          chatError={chatError}
        />
      </div>
    </ChatMessagesProvider>
  );
};
