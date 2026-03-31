import React from 'react';
import type { ChatMessage } from 'amazon-ivs-chat-messaging';
import { MessageRow } from './MessageRow';

interface MessageListProps {
  messages: ChatMessage[];
  sessionOwnerId: string;
  currentUserId?: string;
  onBounce?: (userId: string) => void;
  onReport?: (msgId: string, userId: string) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  sessionOwnerId,
  currentUserId,
  onBounce,
  onReport,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  const [hasNewMessages, setHasNewMessages] = React.useState(false);

  // Track scroll position
  const handleScroll = () => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setIsAtBottom(distanceFromBottom < 100);
    }
  };

  // Auto-scroll if at bottom (smooth)
  React.useEffect(() => {
    if (isAtBottom && containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
      setHasNewMessages(false);
    } else if (messages.length > 0) {
      setHasNewMessages(true);
    }
  }, [messages, isAtBottom]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'smooth',
      });
      setIsAtBottom(true);
      setHasNewMessages(false);
    }
  };

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-3 py-2 scroll-smooth"
      >
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            isBroadcaster={message.sender?.userId === sessionOwnerId}
            isBroadcasterViewing={!!currentUserId && currentUserId === sessionOwnerId}
            isOwnMessage={!!currentUserId && message.sender?.userId === currentUserId}
            onBounce={onBounce}
            onReport={onReport}
          />
        ))}
      </div>
      {!isAtBottom && hasNewMessages && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-full shadow-lg hover:bg-blue-700 transition-colors"
        >
          New messages ↓
        </button>
      )}
    </div>
  );
};
