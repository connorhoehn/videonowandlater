import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { loadConfig } from './config/aws-config';
import { configureAuth } from './auth/amplify';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import { StackNotDeployed } from './components/StackNotDeployed';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { HomePage } from './pages/HomePage';
import { BroadcastPage } from './features/broadcast/BroadcastPage';
import { ViewerPage } from './features/viewer/ViewerPage';
import { ReplayViewer } from './features/replay/ReplayViewer';
import { HangoutPage } from './features/hangout/HangoutPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontSize: '1.2rem',
      }}>
        Loading...
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function App() {
  const [configState, setConfigState] = useState<'loading' | 'loaded' | 'missing'>('loading');

  useEffect(() => {
    loadConfig().then((config) => {
      if (config) {
        configureAuth(config);
        setConfigState('loaded');
      } else {
        setConfigState('missing');
      }
    });
  }, []);

  if (configState === 'loading') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontSize: '1.2rem',
      }}>
        Loading configuration...
      </div>
    );
  }

  if (configState === 'missing') {
    return <StackNotDeployed />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<Layout />}>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <HomePage />
                </ProtectedRoute>
              }
            />
          </Route>
          <Route
            path="/broadcast/:sessionId"
            element={
              <ProtectedRoute>
                <BroadcastPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/viewer/:sessionId"
            element={
              <ProtectedRoute>
                <ViewerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/replay/:sessionId"
            element={
              <ProtectedRoute>
                <ReplayViewer />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hangout/:sessionId"
            element={
              <ProtectedRoute>
                <HangoutPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
