import { useState, useMemo, useEffect } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { useDarkMode } from '../hooks/useDarkMode';
import { useNavbarActions } from '../hooks/useNavbarActions';
import { useSidebarData } from '../hooks/useSidebarData';
import { useAuth } from '../auth/useAuth';
import { ActivityProvider } from '../hooks/useActivityData';
import { PageTransition } from './PageTransition';
import { fetchToken } from '../auth/fetchToken';
import { getConfig } from '../config/aws-config';
import {
  AppShell,
  Navbar,
  NavIconButton,
  ProfileSidebar,
  SuggestionWidget,
  NewsWidget,
  FooterLinks,
  UserAvatarDropdown,
  NotificationDropdown,
  ChatLauncher,
  OffcanvasSidebar,
} from './social';
import { ChatIcon, MenuIcon } from './social/Icons';

// Routes that should use full-width layout (no sidebars)
const FULL_WIDTH_PATTERNS = ['/replay/', '/broadcast/', '/viewer/', '/hangout/', '/upload/', '/video/', '/admin', '/settings'];

export function AuthenticatedShell() {
  const { user, handleSignOut } = useNavbarActions();
  const { isAdmin } = useAuth();
  const { profileStats, suggestions, newsItems } = useSidebarData();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isDark, toggle: toggleDarkMode } = useDarkMode();

  const isFullWidth = useMemo(
    () => FULL_WIDTH_PATTERNS.some(p => location.pathname.startsWith(p)),
    [location.pathname]
  );

  // Pending-invite badge count — polled every 30s.
  const [pendingInviteCount, setPendingInviteCount] = useState(0);
  useEffect(() => {
    const apiBaseUrl = getConfig()?.apiUrl;
    if (!apiBaseUrl) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const { token } = await fetchToken();
        if (!token || cancelled) return;
        const res = await fetch(`${apiBaseUrl}/invites/mine?status=pending`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { invites?: unknown[] };
        if (!cancelled) setPendingInviteCount(data.invites?.length ?? 0);
      } catch {
        /* silent — the bell will just show 0 */
      }
    };
    fetchCount();
    const id = window.setInterval(fetchCount, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const navbar = (
    <Navbar
      brand={{ label: 'videonow', href: '/' }}
      actions={
        <div className="flex items-center gap-2">
          {/* Mobile sidebar hamburger — visible below lg */}
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileSidebarOpen(true)}
            className="lg:hidden w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <MenuIcon size={18} />
          </button>
          {isAdmin && (
            <Link
              to="/admin"
              className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
              title="Admin"
            >
              <svg className="w-[18px] h-[18px] text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </Link>
          )}
          <Link
            to="/settings"
            className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
            title="Settings"
          >
            <svg className="w-[18px] h-[18px] text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
          <NavIconButton icon={<ChatIcon size={18} />} label="Messages" />
          <button
            type="button"
            aria-label="Invitations"
            title={
              pendingInviteCount > 0
                ? `${pendingInviteCount} pending invitation${pendingInviteCount === 1 ? '' : 's'}`
                : 'Invitations'
            }
            onClick={() => navigate('/settings/invites')}
            className="relative w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          >
            <svg className="w-[18px] h-[18px] text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {pendingInviteCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                {pendingInviteCount > 99 ? '99+' : pendingInviteCount}
              </span>
            )}
          </button>
          <NotificationDropdown notifications={[]} unreadCount={0} />
          <UserAvatarDropdown
            user={{ name: user?.username ?? '' }}
            onProfile={() => navigate('/')}
            onSettings={() => navigate('/settings')}
            onSignOut={handleSignOut}
            darkMode={isDark}
            onToggleDarkMode={toggleDarkMode}
          />
        </div>
      }
    />
  );

  const leftSidebar = (
    <>
      <ProfileSidebar
        user={{
          name: user?.username ?? '',
          stats: profileStats,
        }}
        navItems={[
          { label: 'Feed', href: '/' },
          { label: 'Settings', href: '/settings' },
        ]}
        onViewProfile={() => navigate('/')}
      />
      <div className="mt-4">
        <FooterLinks />
      </div>
    </>
  );

  const rightSidebar = (
    <>
      <SuggestionWidget title="Who to watch" users={suggestions} />
      <div className="mt-4">
        <NewsWidget title="Recent recordings" items={newsItems} />
      </div>
    </>
  );

  return (
    <ActivityProvider>
      <AppShell
        navbar={navbar}
        leftSidebar={isFullWidth ? undefined : leftSidebar}
        rightSidebar={isFullWidth ? undefined : rightSidebar}
        fullWidth={isFullWidth}
      >
        <AnimatePresence mode="wait">
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </AnimatePresence>
      </AppShell>

      {/* Mobile offcanvas sidebar — profile + nav for small screens */}
      <OffcanvasSidebar
        isOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        title="Menu"
        side="left"
      >
        <ProfileSidebar
          user={{
            name: user?.username ?? '',
            stats: profileStats,
          }}
          navItems={[
            { label: 'Feed', href: '/' },
            { label: 'Settings' },
          ]}
          onViewProfile={() => {
            navigate('/');
            setMobileSidebarOpen(false);
          }}
        />
        <div className="mt-4">
          <FooterLinks />
        </div>
      </OffcanvasSidebar>

      <ChatLauncher />
    </ActivityProvider>
  );
}
