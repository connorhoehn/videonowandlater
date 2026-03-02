import React from 'react';
import { ChatMessage } from 'amazon-ivs-chat-messaging';

interface MessageRowProps {
  message: ChatMessage;
  isBroadcaster: boolean;
}

function calculateRelativeTime(sentAt: string): string {
  const seconds = Math.floor((Date.now() - new Date(sentAt).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const MessageRow: React.FC<MessageRowProps> = ({ message, isBroadcaster }) => {
  const [relativeTime, setRelativeTime] = React.useState(() =>
    calculateRelativeTime(message.sendTime)
  );

  React.useEffect(() => {
    const interval = setInterval(() => {
      setRelativeTime(calculateRelativeTime(message.sendTime));
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [message.sendTime]);

  return (
    <div className="mb-2">
      <div className="flex items-baseline space-x-2 text-sm">
        <span className="font-semibold text-gray-900">
          {message.sender.attributes.displayName || message.sender.userId}
        </span>
        {isBroadcaster && (
          <span className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
            Broadcaster
          </span>
        )}
        <span className="text-xs text-gray-500">{relativeTime}</span>
      </div>
      <p className="text-sm text-gray-800 mt-0.5">{message.content}</p>
    </div>
  );
};
