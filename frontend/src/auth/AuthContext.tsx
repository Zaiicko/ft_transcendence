import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import i18n, { LanguageCode, loadLanguage, SUPPORTED_LANGUAGES } from '../i18n';
import { apiFetch } from '../lib/api';
import type { PublicUser } from '../lib/types';

// Apply the language saved on the profile (roams across devices); 'en' is ignored so browser/localStorage detection wins for a brand-new account.
function applyUserLanguage(user: PublicUser): void {
  const code = user.language as LanguageCode;
  if (
    code !== 'en' &&
    SUPPORTED_LANGUAGES.some((l) => l.code === code) &&
    i18n.resolvedLanguage !== code
  ) {
    void loadLanguage(code).then(() => i18n.changeLanguage(code));
  }
}

type LoginResult = PublicUser | { requiresTwoFactor: true };

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ requiresTwoFactor: true } | void>;
  completeTwoFactorLogin: (code: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
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

  const applyUser = useCallback((me: PublicUser) => {
    setUser(me);
    applyUserLanguage(me);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await apiFetch<PublicUser | null>('/auth/me');
      if (me) applyUser(me);
      else setUser(null);
    } catch {
      setUser(null);
    }
  }, [applyUser]);

  useEffect(() => {
    // setState only in the async callbacks, never in the effect body (react-hooks/set-state-in-effect); /auth/me returns the user or null (200).
    apiFetch<PublicUser | null>('/auth/me')
      .then((me) => (me ? applyUser(me) : setUser(null)))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [applyUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiFetch<LoginResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (isTwoFactorChallenge(result)) return result;
      applyUser(result);
    },
    [applyUser],
  );

  const completeTwoFactorLogin = useCallback(
    async (code: string) => {
      applyUser(
        await apiFetch<PublicUser>('/auth/2fa/verify-login', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
      );
    },
    [applyUser],
  );

  const signup = useCallback(
    async (email: string, password: string) => {
      applyUser(
        await apiFetch<PublicUser>('/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        }),
      );
    },
    [applyUser],
  );

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
