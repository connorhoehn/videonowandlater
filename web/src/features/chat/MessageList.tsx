import React from 'react';
import { ChatMessage } from 'amazon-ivs-chat-messaging';
import { MessageRow } from './MessageRow';

interface MessageListProps {
  messages: ChatMessage[];
  sessionOwnerId: string;
}

export const MessageList: React.FC<MessageListProps> = ({ messages, sessionOwnerId }) => {
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

  // Auto-scroll if at bottom
  React.useEffect(() => {
    if (isAtBottom && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
  }, [messages, isAtBottom]);

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      setIsAtBottom(true);
      setHasNewMessages(false);
    }
  };

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-2"
      >
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            isBroadcaster={message.sender.userId === sessionOwnerId}
          />
        ))}
      </div>
      {!isAtBottom && hasNewMessages && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 px-3 py-1 bg-blue-600 text-white text-sm rounded-full shadow-lg hover:bg-blue-700"
        >
          New messages ↓
        </button>
      )}
    </div>
  );
};
