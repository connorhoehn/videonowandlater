import React from 'react';
import type { ChatMessage } from 'amazon-ivs-chat-messaging';

interface MessageRowProps {
  message: ChatMessage;
  isBroadcaster: boolean;
  isBroadcasterViewing?: boolean;
  isOwnMessage?: boolean;
  onBounce?: (userId: string) => void;
  onReport?: (msgId: string, reportedUserId: string) => void;
}

function calculateRelativeTime(sentAt: Date | undefined): string {
  if (!sentAt) return '';
  const seconds = Math.floor((Date.now() - sentAt.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Returns true if the content is purely emoji (1-8 emoji characters, no text) */
function isEmojiOnly(content: string): boolean {
  // Strip variation selectors and ZWJ for counting
  const stripped = content.replace(/[\uFE0F\u200D]/g, '');
  // Match common emoji ranges
  const emojiRegex =
    /^[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\u{FE0F}\u{200D}\s]+$/u;
  return emojiRegex.test(content.trim()) && stripped.length <= 16;
}

interface ContextMenuState {
  x: number;
  y: number;
}

export const MessageRow: React.FC<MessageRowProps> = ({
  message,
  isBroadcaster,
  isBroadcasterViewing,
  isOwnMessage,
  onBounce,
  onReport,
}) => {
  const [relativeTime, setRelativeTime] = React.useState(() =>
    calculateRelativeTime(message.sendTime)
  );
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setRelativeTime(calculateRelativeTime(message.sendTime));
    }, 60000);
    return () => clearInterval(interval);
  }, [message.sendTime]);

  // Close context menu on outside click
  React.useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu]);

  const showModMenu = !isOwnMessage && (isBroadcasterViewing || onReport);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!showModMenu) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!showModMenu) return;
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      setContextMenu({ x: touch.clientX, y: touch.clientY });
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const emojiOnly = isEmojiOnly(message.content);
  const displayName =
    message.sender?.attributes?.displayName || message.sender?.userId;

  return (
    <div
      ref={rowRef}
      className="animate-chat-in mb-1.5 group relative"
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Message bubble */}
      <div
        className={`rounded-2xl px-3.5 py-2 inline-block max-w-[85%] ${
          isOwnMessage
            ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white ml-auto shadow-sm'
            : 'bg-gray-100 text-gray-900'
        }`}
        style={isOwnMessage ? { float: 'right' } : undefined}
      >
        {/* Username + badges + time */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className={`text-xs font-semibold leading-tight ${
              isOwnMessage ? 'text-blue-100' : 'text-gray-500'
            }`}
          >
            {displayName}
          </span>
          {isBroadcaster && (
            <span className="px-1 py-px text-[10px] font-bold uppercase tracking-wide bg-red-500 text-white rounded">
              Host
            </span>
          )}
          <span
            className={`text-[10px] leading-tight ${
              isOwnMessage ? 'text-blue-200' : 'text-gray-400'
            }`}
          >
            {relativeTime}
          </span>
        </div>

        {/* Content */}
        {emojiOnly ? (
          <p className="text-4xl leading-tight py-0.5 select-text">{message.content}</p>
        ) : (
          <p
            className={`text-sm leading-snug break-words select-text ${
              isOwnMessage ? 'text-white' : 'text-gray-800'
            }`}
          >
            {message.content}
          </p>
        )}
      </div>

      {/* Clear float */}
      {isOwnMessage && <div className="clear-both" />}

      {/* Hover actions (desktop, kept for quick access) */}
      {showModMenu && (
        <div className="absolute right-0 top-0 hidden group-hover:flex gap-0.5 items-center bg-white/90 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 px-1 py-0.5">
          {isBroadcasterViewing && !isOwnMessage && onBounce && (
            <button
              onClick={() => onBounce(message.sender?.userId ?? '')}
              className="text-[11px] text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors"
              title="Remove from chat"
            >
              Kick
            </button>
          )}
          {!isOwnMessage && onReport && (
            <button
              onClick={() => onReport(message.id, message.sender?.userId ?? '')}
              className="text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors"
              title="Report message"
            >
              Report
            </button>
          )}
        </div>
      )}

      {/* Context menu (right-click / long-press) */}
      {contextMenu && (
        <div
          className="animate-context-menu fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {isBroadcasterViewing && !isOwnMessage && onBounce && (
            <button
              onClick={() => {
                onBounce(message.sender?.userId ?? '');
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
            >
              <span className="text-base">🚫</span> Kick User
            </button>
          )}
          {!isOwnMessage && onReport && (
            <button
              onClick={() => {
                onReport(message.id, message.sender?.userId ?? '');
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center gap-2"
            >
              <span className="text-base">🚩</span> Report Message
            </button>
          )}
          <button
            onClick={() => setContextMenu(null)}
            className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};
