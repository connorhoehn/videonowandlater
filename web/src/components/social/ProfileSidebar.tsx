import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Built-in SVG icons for common nav items                           */
/* ------------------------------------------------------------------ */

const IconFeed = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
  </svg>
);

const IconNotifications = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
  </svg>
);

const IconSettings = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.38.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

/** Lookup table so callers can omit `icon` for common labels. */
const DEFAULT_ICONS: Record<string, ReactNode> = {
  feed: <IconFeed />,
  home: <IconFeed />,
  notifications: <IconNotifications />,
  settings: <IconSettings />,
};

function defaultIconFor(label: string): ReactNode | undefined {
  return DEFAULT_ICONS[label.toLowerCase()];
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NavItem {
  label: string;
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
  active?: boolean;
}

interface ProfileSidebarProps {
  user: {
    name: string;
    avatar?: string;
    coverImage?: string;
    subtitle?: string;
    bio?: string;
    stats?: { label: string; value: string | number }[];
  };
  navItems?: NavItem[];
  onViewProfile?: () => void;
  footerLinks?: { label: string; href?: string; onClick?: () => void }[];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ProfileSidebar({
  user,
  navItems,
  onViewProfile,
  footerLinks,
}: ProfileSidebarProps) {
  const { name, avatar, coverImage, subtitle, bio, stats } = user;

  // Build initials for the fallback avatar
  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="w-full">
      {/* ---- Card ---- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        {/* Cover */}
        {coverImage ? (
          <div
            className="h-20 bg-cover bg-center"
            style={{ backgroundImage: `url(${coverImage})` }}
          />
        ) : (
          <div className="h-20 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
        )}

        {/* Avatar */}
        <div className="flex justify-center">
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="w-16 h-16 rounded-full border-4 border-white dark:border-gray-800 -mt-8 object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full border-4 border-white dark:border-gray-800 -mt-8 bg-blue-500 flex items-center justify-center text-white font-semibold text-lg">
              {initials}
            </div>
          )}
        </div>

        {/* Name & subtitle */}
        <h3 className="text-lg font-semibold text-center mt-2 text-gray-900 dark:text-gray-100">
          {name}
        </h3>
        {subtitle && (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
            {subtitle}
          </p>
        )}

        {/* Bio */}
        {bio && (
          <p className="text-sm text-gray-600 dark:text-gray-300 text-center mt-3 px-4">
            {bio}
          </p>
        )}

        {/* Stats */}
        {stats && stats.length > 0 && (
          <div className="flex items-center justify-center mt-4 px-4">
            {stats.map((stat, i) => (
              <div key={stat.label} className="flex items-center">
                {i > 0 && (
                  <div className="w-px h-8 bg-gray-200 dark:bg-gray-600 mx-4" />
                )}
                <div className="text-center min-w-[3rem]">
                  <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                    {stat.value}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {stat.label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Divider + Nav */}
        {navItems && navItems.length > 0 && (
          <>
            <div className="border-t border-gray-200 dark:border-gray-700 my-3 mx-4" />
            <nav className="px-2 pb-2">
              {navItems.map((item) => {
                const icon = item.icon ?? defaultIconFor(item.label);
                const classes = [
                  'flex items-center gap-3 py-2 px-4 rounded-lg text-sm font-medium transition-colors',
                  item.active
                    ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50',
                ].join(' ');

                const content = (
                  <>
                    {icon && (
                      <span className="shrink-0 text-current">{icon}</span>
                    )}
                    <span>{item.label}</span>
                  </>
                );

                if (item.href) {
                  return (
                    <a
                      key={item.label}
                      href={item.href}
                      className={classes}
                      onClick={item.onClick}
                    >
                      {content}
                    </a>
                  );
                }

                return (
                  <button
                    key={item.label}
                    type="button"
                    className={`${classes} w-full text-left`}
                    onClick={item.onClick}
                  >
                    {content}
                  </button>
                );
              })}
            </nav>
          </>
        )}

        {/* View Profile link */}
        {onViewProfile && (
          <>
            <div className="border-t border-gray-200 dark:border-gray-700 mx-4" />
            <div className="py-3 text-center">
              <button
                type="button"
                onClick={onViewProfile}
                className="text-sm text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 font-medium transition-colors"
              >
                View Profile
              </button>
            </div>
          </>
        )}
      </div>

      {/* ---- Footer links ---- */}
      {footerLinks && footerLinks.length > 0 && (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3 px-2">
          {footerLinks.map((link) => {
            if (link.href) {
              return (
                <a
                  key={link.label}
                  href={link.href}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  onClick={link.onClick}
                >
                  {link.label}
                </a>
              );
            }
            return (
              <button
                key={link.label}
                type="button"
                onClick={link.onClick}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {link.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
