import { Avatar } from './Avatar';
import { Card } from './Card';
import { PlusIcon, ChatIcon, CheckIcon } from './Icons';

export interface ConnectionCardProps {
  user: {
    id: string;
    name: string;
    avatar?: string;
    subtitle?: string;
    mutualConnections?: number;
  };
  isConnected?: boolean;
  onConnect?: (userId: string) => void;
  onMessage?: (userId: string) => void;
  onClick?: (userId: string) => void;
  className?: string;
}

export function ConnectionCard({
  user,
  isConnected = false,
  onConnect,
  onMessage,
  onClick,
  className = '',
}: ConnectionCardProps) {
  return (
    <Card className={className}>
      <Card.Body className="text-center p-4">
        <div
          className={onClick ? 'cursor-pointer' : ''}
          onClick={() => onClick?.(user.id)}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : undefined}
          onKeyDown={
            onClick
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick(user.id);
                  }
                }
              : undefined
          }
        >
          <div className="flex justify-center">
            <Avatar
              src={user.avatar}
              alt={user.name}
              name={user.name}
              size="xl"
            />
          </div>
          <p className="text-sm font-semibold mt-3 truncate">{user.name}</p>
          {user.subtitle && (
            <p className="text-xs text-gray-500 truncate">{user.subtitle}</p>
          )}
          {user.mutualConnections != null && user.mutualConnections > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              {user.mutualConnections} mutual connection
              {user.mutualConnections !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div className="flex gap-2 mt-3">
          <button
            type="button"
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              isConnected
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
            }`}
            onClick={() => onConnect?.(user.id)}
          >
            {isConnected ? (
              <>
                <CheckIcon size={14} />
                Connected
              </>
            ) : (
              <>
                <PlusIcon size={14} />
                Connect
              </>
            )}
          </button>
          <button
            type="button"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors shrink-0"
            onClick={() => onMessage?.(user.id)}
            aria-label={`Message ${user.name}`}
          >
            <ChatIcon size={14} />
          </button>
        </div>
      </Card.Body>
    </Card>
  );
}
