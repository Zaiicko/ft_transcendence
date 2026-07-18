import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { PublicUser } from '../lib/types';

type LoginResult = PublicUser | { requiresTwoFactor: true };

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ requiresTwoFactor: true } | void>;
  completeTwoFactorLogin: (code: string) => Promise<void>;
  signup: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

function isTwoFactorChallenge(result: LoginResult): result is { requiresTwoFactor: true } {
  return 'requiresTwoFactor' in result;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await apiFetch<PublicUser>('/auth/me'));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiFetch<LoginResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (isTwoFactorChallenge(result)) return result;
    setUser(result);
  }, []);

  const completeTwoFactorLogin = useCallback(async (code: string) => {
    setUser(
      await apiFetch<PublicUser>('/auth/2fa/verify-login', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    );
  }, []);

  const signup = useCallback(async (email: string, username: string, password: string) => {
    setUser(
      await apiFetch<PublicUser>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, username, password }),
      }),
    );
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, completeTwoFactorLogin, signup, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
