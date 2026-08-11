import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import i18n, { LanguageCode, loadLanguage, SUPPORTED_LANGUAGES } from '../i18n';
import { apiFetch, refreshSession, SESSION_EXPIRED_EVENT } from '../lib/api';
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
  login: (identifier: string, password: string) => Promise<{ requiresTwoFactor: true } | void>;
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
  const navigate = useNavigate();

  const applyUser = useCallback((me: PublicUser) => {
    setUser(me);
    applyUserLanguage(me);
  }, []);

  // /auth/me only reads the short-lived (15min) access token cookie and
  // returns null once it's lapsed — even with a valid 30-day refresh token
  // still sitting in the cookies. Falling back to a refresh here means a
  // page reload after 15 minutes doesn't look like a logout.
  const meOrRefresh = useCallback(async (): Promise<PublicUser | null> => {
    const me = await apiFetch<PublicUser | null>('/auth/me');
    return me ?? (await refreshSession<PublicUser>());
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await meOrRefresh();
      if (me) applyUser(me);
      else setUser(null);
    } catch {
      setUser(null);
    }
  }, [applyUser, meOrRefresh]);

  useEffect(() => {
    // setState only in the async callbacks, never in the effect body (react-hooks/set-state-in-effect).
    meOrRefresh()
      .then((me) => (me ? applyUser(me) : setUser(null)))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [applyUser, meOrRefresh]);

  // Fired by apiFetch when a 401 survives a refresh attempt — the refresh
  // token itself is gone, so this is a real logout, not a transient blip.
  // Only redirect with a message if we actually thought we were signed in,
  // so an anonymous visit hitting some optionally-authenticated endpoint
  // doesn't bounce anyone. A ref (not `user` in the closure) keeps the
  // listener itself stable across renders.
  const userRef = useRef<PublicUser | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  useEffect(() => {
    function onExpired() {
      if (userRef.current) navigate('/login?sessionExpired=1', { replace: true });
      setUser(null);
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const result = await apiFetch<LoginResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
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
