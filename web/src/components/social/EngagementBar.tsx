import { ThumbsUpIcon, HeartIcon, HeartFilledIcon, ChatIcon, ShareIcon, SendIcon } from './Icons';

interface EngagementBarProps {
  likes?: number;
  comments?: number;
  shares?: number;
  liked?: boolean;
  variant?: 'stacked' | 'fill';
  onLike?: () => void;
  onComment?: () => void;
  onShare?: () => void;
  onSend?: () => void;
  showSend?: boolean;
  className?: string;
}

function formatCount(n: number | undefined): string | null {
  if (n == null || n <= 0) return null;
  return String(n);
}

export function EngagementBar({
  likes,
  comments,
  shares,
  liked = false,
  variant = 'stacked',
  onLike,
  onComment,
  onShare,
  onSend,
  showSend = false,
  className = '',
}: EngagementBarProps) {
  if (variant === 'fill') {
    return (
      <div
        className={`flex items-center justify-around border-t border-gray-100 dark:border-gray-700 py-2 ${className}`}
      >
        <button
          type="button"
          onClick={onLike}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors cursor-pointer ${
            liked
              ? 'text-red-500'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          {liked ? <HeartFilledIcon size={18} /> : <HeartIcon size={18} />}
          {formatCount(likes) && <span>{formatCount(likes)}</span>}
        </button>

        <button
          type="button"
          onClick={onShare}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 transition-colors cursor-pointer"
        >
          <ShareIcon size={18} />
          {formatCount(shares) && <span>{formatCount(shares)}</span>}
        </button>

        {showSend && (
          <button
            type="button"
            onClick={onSend}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200 transition-colors cursor-pointer"
          >
            <SendIcon size={18} />
          </button>
        )}
      </div>
    );
  }

  // stacked variant
  const actionBase =
    'flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors cursor-pointer';
  const defaultColor =
    'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800';

  return (
    <div className={`flex items-center gap-1 text-sm ${className}`}>
      <button
        type="button"
        onClick={onLike}
        className={`${actionBase} ${liked ? 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30' : defaultColor}`}
      >
        <ThumbsUpIcon size={18} />
        <span>Liked ({likes ?? 0})</span>
      </button>

      <button
        type="button"
        onClick={onComment}
        className={`${actionBase} ${defaultColor}`}
      >
        <ChatIcon size={18} />
        <span>Comments ({comments ?? 0})</span>
      </button>

      <button
        type="button"
        onClick={onShare}
        className={`${actionBase} ${defaultColor} ms-auto`}
      >
        <ShareIcon size={18} />
        <span>Share ({shares ?? 0})</span>
      </button>
    </div>
  );
}
