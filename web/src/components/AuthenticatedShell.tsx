import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
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
} from './social';
import { ChatIcon, BellIcon } from './social/Icons';

export function AuthenticatedShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const navbar = (
    <Navbar
      brand={{ label: 'videonow', href: '/' }}
      actions={
        <div className="flex items-center gap-2">
          <NavIconButton icon={<ChatIcon size={18} />} label="Messages" />
          <NotificationDropdown notifications={[]} unreadCount={0} />
          <UserAvatarDropdown
            user={{ name: user?.username ?? '' }}
            onProfile={() => navigate('/')}
            onSettings={() => navigate('/')}
            onSignOut={() => signOut()}
          />
        </div>
      }
    />
  );

  const leftSidebar = (
    <>
      <ProfileSidebar
        user={{ name: user?.username ?? '' }}
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
      <SuggestionWidget users={[]} />
      <div className="mt-4">
        <NewsWidget items={[]} />
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
        <Outlet />
      </AppShell>
      <ChatLauncher />
    </>
  );
}
