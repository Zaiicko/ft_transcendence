import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import i18n, { LanguageCode, loadLanguage, SUPPORTED_LANGUAGES } from '../i18n';
import { apiFetch } from '../lib/api';
import type { PublicUser } from '../lib/types';

// Applique la langue enregistrée sur le profil, pour la retrouver d'un
// appareil à l'autre une fois connecté. 'en' est ignoré : c'est aussi la
// valeur par défaut en base pour un compte qui n'a jamais choisi de langue
// explicitement (via le sélecteur, qui PATCH /users/me à chaque changement)
// — le traiter comme "non défini" laisse la détection navigateur/
// localStorage gagner pour un nouvel inscrit dont le compte est encore à
// sa valeur par défaut, au lieu d'écraser à tort un français auto-détecté.
function applyUserLanguage(user: PublicUser): void {
  const code = user.language as LanguageCode;
  if (
    code !== 'en' &&
    SUPPORTED_LANGUAGES.some((l) => l.code === code) &&
    i18n.resolvedLanguage !== code
  ) {
    // Charge la locale (lazy) avant de basculer, sinon flash de clés brutes.
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
    // setState only happens in the promise callbacks (async), never in the
    // effect's synchronous body — see react-hooks/set-state-in-effect
    // /auth/me renvoie l'utilisateur ou null (200) — plus de 401 déconnecté.
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
    // Pas de pseudo : il est choisi ensuite dans le wizard d'onboarding (le
    // backend en génère un provisoire depuis l'e-mail).
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
