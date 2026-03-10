import React from 'react';
import { SendMessageRequest } from 'amazon-ivs-chat-messaging';
import { useChatRoomContext } from './ChatRoomProvider';
import { ChatMessagesProvider, useChatMessagesContext } from './ChatMessagesProvider';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { EmptyState } from './EmptyState';
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
    return <span className="text-xs text-green-600">● Connected</span>;
  }
  if (state === 'connecting') {
    return <span className="text-xs text-yellow-600">● Connecting...</span>;
  }
  return <span className="text-xs text-red-600">● Disconnected</span>;
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
      <div className="border-b border-gray-300 p-3 flex items-center justify-between">
        <h2 className="font-semibold">Chat</h2>
        {isMobile && onClose && (
          <button onClick={onClose} className="text-gray-600">
            Close
          </button>
        )}
        <ConnectionIndicator state={connectionState} />
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
          <EmptyState />
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
        <div className="absolute bottom-16 left-4 right-4 bg-gray-800 text-white text-sm px-3 py-2 rounded shadow-lg text-center pointer-events-none">
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
      await room.sendMessage(new SendMessageRequest(content));
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleBounce = async (targetUserId: string) => {
    if (!authToken) return;
    const apiUrl = getConfig()?.apiUrl;
    if (!apiUrl) return;
    try {
      await fetch(`${apiUrl}/sessions/${sessionId}/bounce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ userId: targetUserId }),
      });
    } catch (err) {
      console.error('Bounce failed:', err);
    }
  };

  const handleReport = async (msgId: string, reportedUserId: string) => {
    if (!authToken) return;
    const apiUrl = getConfig()?.apiUrl;
    if (!apiUrl) return;
    try {
      await fetch(`${apiUrl}/sessions/${sessionId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ msgId, reportedUserId }),
      });
      showToast('Message reported');
    } catch (err) {
      console.error('Report failed:', err);
    }
  };

  const overlayClasses = isMobile
    ? `fixed inset-0 z-50 bg-white transform transition-transform ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`
    : 'w-full h-full';

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
