import { useState, useRef, useEffect } from 'react';
import { Avatar } from './Avatar';
import { UserIcon, GearIcon, MoonIcon, SunIcon } from './Icons';

interface UserAvatarDropdownProps {
  user: { name: string; avatar?: string; email?: string; subtitle?: string };
  onProfile?: () => void;
  onSettings?: () => void;
  onSignOut?: () => void;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
  className?: string;
}

export function UserAvatarDropdown({
  user,
  onProfile,
  onSettings,
  onSignOut,
  darkMode = false,
  onToggleDarkMode,
  className = '',
}: UserAvatarDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const itemClass =
    'flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors';

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <Avatar
        src={user.avatar}
        alt={user.name}
        name={user.name}
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        className="cursor-pointer"
      />

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden"
          style={{ animation: 'dropdown-in 150ms ease-out' }}
        >
          <style>{`
            @keyframes dropdown-in {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>

          {/* User info header */}
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              {user.name}
            </div>
            {(user.email || user.subtitle) && (
              <div className="text-xs text-gray-500 truncate">
                {user.email ?? user.subtitle}
              </div>
            )}
          </div>

          {/* Menu items */}
          <div className="py-1">
            {onProfile && (
              <button
                className={`${itemClass} w-full text-left`}
                onClick={() => {
                  onProfile();
                  setOpen(false);
                }}
              >
                <UserIcon size={16} />
                View Profile
              </button>
            )}

            {onSettings && (
              <button
                className={`${itemClass} w-full text-left`}
                onClick={() => {
                  onSettings();
                  setOpen(false);
                }}
              >
                <GearIcon size={16} />
                Settings
              </button>
            )}

            {onToggleDarkMode && (
              <button
                className={`${itemClass} w-full text-left justify-between`}
                onClick={() => {
                  onToggleDarkMode();
                }}
              >
                <span className="flex items-center gap-3">
                  {darkMode ? <SunIcon size={16} /> : <MoonIcon size={16} />}
                  Dark Mode
                </span>
                {/* Toggle switch */}
                <span
                  className={`w-9 h-5 rounded-full relative transition-colors ${
                    darkMode ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute w-4 h-4 rounded-full bg-white shadow top-0.5 transition-all ${
                      darkMode ? 'left-4' : 'left-0.5'
                    }`}
                  />
                </span>
              </button>
            )}
          </div>

          {onSignOut && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-700" />
              <div className="py-1">
                <button
                  className={`${itemClass} w-full text-left text-red-600 hover:bg-red-50 dark:hover:bg-gray-700`}
                  onClick={() => {
                    onSignOut();
                    setOpen(false);
                  }}
                >
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
