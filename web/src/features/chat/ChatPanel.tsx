import React from 'react';
import { SendMessageRequest } from 'amazon-ivs-chat-messaging';
import { useChatRoom } from './useChatRoom';
import { ChatRoomProvider } from './ChatRoomProvider';
import { ChatMessagesProvider, useChatMessagesContext } from './ChatMessagesProvider';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { EmptyState } from './EmptyState';
import { LoadingState } from './LoadingState';

interface ChatPanelProps {
  sessionId: string;
  sessionOwnerId: string;
  authToken: string;
  isMobile: boolean;
  isOpen: boolean;
  onClose?: () => void;
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
}

const ChatPanelContent: React.FC<ChatPanelContentProps> = ({
  sessionOwnerId,
  connectionState,
  onSendMessage,
  isMobile,
  onClose,
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

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        {isLoadingHistory ? (
          <LoadingState />
        ) : messages.length === 0 ? (
          <EmptyState />
        ) : (
          <MessageList messages={messages} sessionOwnerId={sessionOwnerId} />
        )}
      </div>

      {/* Input */}
      <MessageInput
        onSendMessage={onSendMessage}
        disabled={connectionState !== 'connected'}
      />
    </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  sessionId,
  sessionOwnerId,
  authToken,
  isMobile,
  isOpen,
  onClose,
}) => {
  const { room, connectionState } = useChatRoom({ sessionId, authToken });

  const handleSendMessage = async (content: string) => {
    try {
      await room.sendMessage(new SendMessageRequest(content));
    } catch (error) {
      console.error('Failed to send message:', error);
      // Show error toast (optional for v1)
    }
  };

  // Mobile overlay classes
  const overlayClasses = isMobile
    ? `fixed inset-0 z-50 bg-white transform transition-transform ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`
    : 'w-full h-full';

  return (
    <ChatRoomProvider value={room}>
      <ChatMessagesProvider sessionId={sessionId} authToken={authToken}>
        <div className={overlayClasses}>
          <ChatPanelContent
            sessionOwnerId={sessionOwnerId}
            connectionState={connectionState}
            onSendMessage={handleSendMessage}
            isMobile={isMobile}
            onClose={onClose}
          />
        </div>
      </ChatMessagesProvider>
    </ChatRoomProvider>
  );
};
