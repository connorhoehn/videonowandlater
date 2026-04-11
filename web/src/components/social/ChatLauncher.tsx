import { ChatIcon } from './Icons';

interface ChatLauncherProps {
  onClick?: () => void;
  unreadCount?: number;
  className?: string;
}

export function ChatLauncher({ onClick, unreadCount = 0, className = '' }: ChatLauncherProps) {
  const displayCount = unreadCount > 9 ? '9+' : String(unreadCount);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`fixed bottom-5 right-5 z-30 hidden lg:flex w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl items-center justify-center transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 ${className}`}
    >
      <ChatIcon size={20} />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
          {displayCount}
        </span>
      )}
    </button>
  );
}
