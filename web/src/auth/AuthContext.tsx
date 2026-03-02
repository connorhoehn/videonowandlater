import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { checkSession, handleSignIn, handleSignUp, handleSignOut } from './amplify';

export interface AuthState {
  user: { username: string } | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<{ username: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session on mount
    checkSession().then((session) => {
      if (session) {
        setUser({ username: session.username });
      }
      setIsLoading(false);
    });
  }, []);

  const signIn = async (username: string, password: string) => {
    await handleSignIn(username, password);
    const session = await checkSession();
    if (session) {
      setUser({ username: session.username });
    }
  };

  const signUp = async (username: string, password: string) => {
    await handleSignUp(username, password);
    // Auto-sign-in after signup
    await handleSignIn(username, password);
    const session = await checkSession();
    if (session) {
      setUser({ username: session.username });
    }
  };

  const signOut = async () => {
    await handleSignOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
