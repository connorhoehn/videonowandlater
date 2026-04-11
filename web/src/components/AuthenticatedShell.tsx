import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { useDarkMode } from '../hooks/useDarkMode';
import { useNavbarActions } from '../hooks/useNavbarActions';
import { useSidebarData } from '../hooks/useSidebarData';
import { PageTransition } from './PageTransition';
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

export function AuthenticatedShell() {
  const { user, handleSignOut } = useNavbarActions();
  const { profileStats, suggestions, newsItems } = useSidebarData();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isDark, toggle: toggleDarkMode } = useDarkMode();

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
          <NavIconButton icon={<ChatIcon size={18} />} label="Messages" />
          <NotificationDropdown notifications={[]} unreadCount={0} />
          <UserAvatarDropdown
            user={{ name: user?.username ?? '' }}
            onProfile={() => navigate('/')}
            onSettings={() => navigate('/')}
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
          { label: 'Settings' },
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
    <>
      <AppShell
        navbar={navbar}
        leftSidebar={leftSidebar}
        rightSidebar={rightSidebar}
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
    </>
  );
}
