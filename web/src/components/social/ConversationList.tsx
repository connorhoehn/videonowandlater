import { Avatar } from './Avatar';
import { Badge } from './Badge';

export interface Conversation {
  id: string;
  name: string;
  avatar?: string;
  lastMessage?: string;
  timestamp?: string;
  unreadCount?: number;
  isOnline?: boolean;
  isTyping?: boolean;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeId?: string;
  onSelect?: (conversationId: string) => void;
  className?: string;
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  className = '',
}: ConversationListProps) {
  return (
    <div className={className}>
      {conversations.map((conversation, index) => {
        const isActive = conversation.id === activeId;
        const isLast = index === conversations.length - 1;

        return (
          <div
            key={conversation.id}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
              isActive
                ? 'bg-blue-50 dark:bg-blue-900/20'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            } ${!isLast ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
            onClick={() => onSelect?.(conversation.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(conversation.id);
              }
            }}
          >
            <Avatar
              src={conversation.avatar}
              alt={conversation.name}
              name={conversation.name}
              size="md"
              isOnline={conversation.isOnline}
            />

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm truncate">
                  {conversation.name}
                </span>
                {conversation.timestamp && (
                  <span className="text-xs text-gray-400 ml-2 shrink-0">
                    {conversation.timestamp}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                {conversation.isTyping ? (
                  <span className="text-xs text-gray-500 italic truncate">
                    Typing...
                  </span>
                ) : (
                  <span className="text-xs text-gray-500 truncate">
                    {conversation.lastMessage}
                  </span>
                )}
                {conversation.unreadCount != null &&
                  conversation.unreadCount > 0 && (
                    <span className="ml-2 shrink-0">
                      <Badge variant="danger" size="sm" pill>
                        {conversation.unreadCount}
                      </Badge>
                    </span>
                  )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
