import { createContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { checkSession, handleSignIn, handleSignUp, handleSignOut } from './amplify';
import { isDemoMode, enableDemoMode, disableDemoMode, DEMO_USER } from '../demo/demoMode';

export interface AuthState {
  user: { username: string } | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterDemoMode: () => void;
}

export const AuthContext = createContext<AuthState | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Demo mode: skip Amplify entirely
    if (isDemoMode()) {
      setUser(DEMO_USER);
      setIsLoading(false);
      return;
    }
    // Check for existing session on mount
    checkSession().then((session) => {
      if (session) {
        setUser({ username: session.username });
        setIsAdmin(session.groups.includes('admin'));
      }
      setIsLoading(false);
    }).catch((err) => {
      console.error('Failed to check auth session:', err);
      setIsLoading(false);
    });
  }, []);

  const signIn = async (username: string, password: string) => {
    await handleSignIn(username, password);
    const session = await checkSession();
    if (session) {
      setUser({ username: session.username });
      setIsAdmin(session.groups.includes('admin'));
    }
  };

  const signUp = async (username: string, password: string) => {
    await handleSignUp(username, password);
    // Auto-sign-in after signup
    await handleSignIn(username, password);
    const session = await checkSession();
    if (session) {
      setUser({ username: session.username });
      setIsAdmin(session.groups.includes('admin'));
    }
  };

  const signOut = async () => {
    if (isDemoMode()) {
      disableDemoMode();
      setUser(null);
      return;
    }
    await handleSignOut();
    setUser(null);
    setIsAdmin(false);
  };

  const enterDemoMode = () => {
    enableDemoMode();
    setUser(DEMO_USER);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        isAdmin,
        signIn,
        signUp,
        signOut,
        enterDemoMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
