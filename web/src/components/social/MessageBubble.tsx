import { Avatar } from './Avatar';

interface MessageBubbleProps {
  content: string;
  timestamp: string;
  sender: { name: string; avatar?: string };
  isSent?: boolean;
  isRead?: boolean;
  showAvatar?: boolean;
  className?: string;
}

function ReadReceipt({ isRead }: { isRead: boolean }) {
  return (
    <span className="inline-flex items-center ml-1">
      <svg
        className={`w-3.5 h-3.5 ${isRead ? 'text-blue-400' : 'text-gray-400'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {isRead ? (
          <>
            <polyline points="2 12 7 17 12 7" />
            <polyline points="9 12 14 17 22 7" />
          </>
        ) : (
          <polyline points="4 12 9 17 20 6" />
        )}
      </svg>
    </span>
  );
}

export function MessageBubble({
  content,
  timestamp,
  sender,
  isSent = false,
  isRead = false,
  showAvatar = true,
  className = '',
}: MessageBubbleProps) {
  if (isSent) {
    return (
      <div className={`flex flex-row-reverse gap-2 ${className}`}>
        <div className="max-w-[75%]">
          <div className="bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2 shadow-sm">
            <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
          </div>
          <div className="flex items-center justify-end mt-1">
            <span className="text-xs text-gray-400">{timestamp}</span>
            <ReadReceipt isRead={isRead} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      {showAvatar ? (
        <Avatar src={sender.avatar} alt={sender.name} name={sender.name} size="xs" />
      ) : (
        <div className="w-6 shrink-0" />
      )}
      <div className="max-w-[75%]">
        {showAvatar && (
          <p className="text-xs font-semibold text-gray-500 mb-0.5">{sender.name}</p>
        )}
        <div className="bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-2xl rounded-bl-sm px-4 py-2 shadow-sm">
          <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
        </div>
        <p className="text-xs text-gray-400 mt-1">{timestamp}</p>
      </div>
    </div>
  );
}
