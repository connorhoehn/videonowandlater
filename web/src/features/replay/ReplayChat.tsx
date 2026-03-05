import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../../backend/src/domain/chat-message';
import { useSynchronizedChat } from './useSynchronizedChat';
import { getConfig } from '../../config/aws-config';

interface ReplayChatProps {
  sessionId: string;
  currentSyncTime: number;
  authToken: string;
}

/**
 * Read-only chat panel for replay viewing with synchronized message display
 */
export function ReplayChat({ sessionId, currentSyncTime, authToken }: ReplayChatProps) {
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch all chat messages on mount
  useEffect(() => {
    const fetchMessages = async () => {
      if (!authToken) return;
      try {
        const apiBaseUrl = getConfig()?.apiUrl || '';
        const response = await fetch(
          `${apiBaseUrl}/sessions/${sessionId}/chat/messages`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch messages: ${response.statusText}`);
        }

        const data = await response.json();
        setAllMessages(data.messages || []);
        setError(null);
      } catch (err) {
        console.error('Failed to load chat history:', err);
        setError('Failed to load chat');
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
  }, [sessionId, authToken]);

  // Get synchronized messages based on current playback position
  const visibleMessages = useSynchronizedChat(allMessages, currentSyncTime);

  // Auto-scroll when visible messages change (as video plays)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages]);

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-gray-50 border-l border-gray-200">
        <div className="border-b border-gray-300 p-3 flex items-center justify-between">
          <h2 className="font-semibold">Chat Replay</h2>
          <span className="px-2 py-1 text-xs font-medium bg-gray-200 text-gray-600 rounded">
            Read Only
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500">Loading chat history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full bg-gray-50 border-l border-gray-200">
        <div className="border-b border-gray-300 p-3 flex items-center justify-between">
          <h2 className="font-semibold">Chat Replay</h2>
          <span className="px-2 py-1 text-xs font-medium bg-gray-200 text-gray-600 rounded">
            Read Only
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 border-l border-gray-200">
      {/* Header */}
      <div className="border-b border-gray-300 p-3 flex items-center justify-between">
        <h2 className="font-semibold">Chat Replay</h2>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-600">
            {visibleMessages.length} / {allMessages.length}
          </span>
          <span className="px-2 py-1 text-xs font-medium bg-gray-200 text-gray-600 rounded">
            Read Only
          </span>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {visibleMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-500">No messages yet</p>
          </div>
        ) : (
          <>
            {visibleMessages.map((message) => (
              <div key={message.messageId} className="mb-2">
                <div className="flex items-baseline space-x-2 text-sm">
                  <span className="font-semibold text-gray-900">
                    {message.senderAttributes?.displayName || message.senderId}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatTimestamp(message.sentAt)}
                  </span>
                </div>
                <p className="text-sm text-gray-800 mt-0.5">{message.content}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Format ISO timestamp to readable time
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
