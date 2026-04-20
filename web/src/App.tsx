import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { loadConfig } from './config/aws-config';
import { configureAuth } from './auth/amplify';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import { isDemoMode, enableDemoMode } from './demo/demoMode';
import { installMockFetch } from './demo/mockFetch';
import { StackNotDeployed } from './components/StackNotDeployed';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { CreatorPage } from './features/creators/CreatorPage';
import { BroadcastPage } from './features/broadcast/BroadcastPage';
import { ViewerPage } from './features/viewer/ViewerPage';
import { ReplayViewer } from './features/replay/ReplayViewer';
import { ClipViewer } from './features/clips/ClipViewer';
import { HangoutPage } from './features/hangout/HangoutPage';
import { EventPage } from './features/events/EventPage';
import { UploadViewer } from './features/upload/UploadViewer';
import { VideoPage } from './features/upload/VideoPage';
import { AdminDashboard } from './features/admin/AdminDashboard';
import { DemoPage } from './demo/DemoPage';
import { AuthenticatedShell } from './components/AuthenticatedShell';
import { SettingsShell } from './features/settings/SettingsShell';
import { ProfilePanel } from './features/settings/ProfilePanel';
import { GroupsPanel } from './features/settings/GroupsPanel';
import { InvitesPanel } from './features/settings/InvitesPanel';
import { NotificationsPanel } from './features/settings/NotificationsPanel';
import { EarningsPanel } from './features/settings/EarningsPanel';
import { AdminSettingsPanel } from './features/settings/AdminSettingsPanel';
import { NotFoundPage } from './pages/NotFoundPage';
import { ToastProvider } from './components/social';

function RedirectToCreator() {
  const { handle } = useParams();
  return <Navigate to={`/creators/${handle ?? ''}`} replace />;
}

function BrandedLoader() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4 animate-page-enter">
      <svg className="branded-spinner w-8 h-8 text-gray-400" viewBox="0 0 50 50">
        <circle cx="25" cy="25" r="20" fill="none" strokeWidth="4" />
      </svg>
      <span className="text-sm font-medium text-gray-400 tracking-tight">videonow</span>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <BrandedLoader />;

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function App() {
  const [configState, setConfigState] = useState<'loading' | 'loaded' | 'missing'>('loading');

  useEffect(() => {
    // Install mock fetch interceptor early if demo mode is already active
    if (isDemoMode()) installMockFetch();

    loadConfig().then((config) => {
      if (config) {
        if (!isDemoMode()) configureAuth(config);
        setConfigState('loaded');
      } else {
        setConfigState('missing');
      }
    }).catch((err) => {
      console.error('Failed to load config:', err);
      setConfigState('missing');
    });
  }, []);

  if (configState === 'loading') {
    return <BrandedLoader />;
  }

  if (configState === 'missing') {
    return <StackNotDeployed onTryDemo={() => {
      enableDemoMode();
      installMockFetch();
      setConfigState('loaded');
    }} />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <Routes>
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          {/* Public clip share page — mounted outside the authenticated shell */}
          <Route path="/clip/:clipId" element={<ClipViewer />} />
          {/* Redirect natural-guess URLs to their real destinations so mistyped
              links land somewhere useful instead of a blank page. */}
          <Route path="/feed" element={<Navigate to="/" replace />} />
          <Route path="/admin/rulesets" element={<Navigate to="/settings/admin" replace />} />
          <Route path="/u/:handle" element={<RedirectToCreator />} />
          <Route element={<ProtectedRoute><AuthenticatedShell /></ProtectedRoute>}>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/creators/:handle" element={<CreatorPage />} />
            <Route path="/@:handle" element={<CreatorPage />} />
            <Route path="/broadcast/:sessionId" element={<BroadcastPage />} />
            <Route path="/viewer/:sessionId" element={<ViewerPage />} />
            <Route path="/replay/:sessionId" element={<ReplayViewer />} />
            <Route path="/hangout/:sessionId" element={<HangoutPage />} />
            <Route path="/events/:sessionId" element={<EventPage />} />
            <Route path="/upload/:sessionId" element={<UploadViewer />} />
            <Route path="/video/:sessionId" element={<VideoPage />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/settings" element={<SettingsShell />}>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<ProfilePanel />} />
              <Route path="groups" element={<GroupsPanel />} />
              <Route path="invites" element={<InvitesPanel />} />
              <Route path="notifications" element={<NotificationsPanel />} />
              <Route path="earnings" element={<EarningsPanel />} />
              <Route path="admin" element={<AdminSettingsPanel />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
