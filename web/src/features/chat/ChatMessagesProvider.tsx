import React from 'react';
import { ChatMessage } from 'amazon-ivs-chat-messaging';
import { useChatRoomContext } from './ChatRoomProvider';

const API_BASE_URL = (window as any).APP_CONFIG?.apiBaseUrl || '';

interface ChatMessagesContextValue {
  messages: ChatMessage[];
  isLoadingHistory: boolean;
}

const ChatMessagesContext = React.createContext<ChatMessagesContextValue>({
  messages: [],
  isLoadingHistory: true,
});

export const useChatMessagesContext = () => {
  const context = React.useContext(ChatMessagesContext);
  return context;
};

interface ChatMessagesProviderProps {
  children: React.ReactNode;
  sessionId: string;
  authToken: string;
}

export const ChatMessagesProvider: React.FC<ChatMessagesProviderProps> = ({
  children,
  sessionId,
  authToken,
}) => {
  const room = useChatRoomContext();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(true);

  // Load history on mount
  React.useEffect(() => {
    const loadHistory = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/sessions/${sessionId}/chat/messages?limit=50`,
          { headers: { Authorization: `Bearer ${authToken}` } }
        );
        const data = await response.json();
        setMessages(data.messages || []);
      } catch (error) {
        console.error('Failed to load chat history:', error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    loadHistory();
  }, [sessionId, authToken]);

  // Listen for new messages
  React.useEffect(() => {
    const unsubscribeMessage = room.addListener('message', (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]); // Append to end
      // Persist message to backend for history
      fetch(`${API_BASE_URL}/sessions/${sessionId}/chat/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          messageId: message.id,
          content: message.content,
          senderId: message.sender.userId,
          senderAttributes: message.sender.attributes,
          sentAt: message.sendTime,
        }),
      }).catch((error) => {
        console.error('Failed to persist message:', error);
        // Fire-and-forget for v1
      });
    });

    const unsubscribeDelete = room.addListener('messageDelete', (deleteEvent: any) => {
      setMessages((prev) => prev.filter((msg) => msg.id !== deleteEvent.messageId));
    });

    return () => {
      unsubscribeMessage();
      unsubscribeDelete();
    };
  }, [room, sessionId, authToken]);

  return (
    <ChatMessagesContext.Provider value={{ messages, isLoadingHistory }}>
      {children}
    </ChatMessagesContext.Provider>
  );
};
