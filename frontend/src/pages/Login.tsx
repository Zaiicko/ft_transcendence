import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import AuthShell from '../components/AuthShell';
import OAuthButtons from '../components/OAuthButtons';
import { ApiError } from '../lib/api';

export default function Login() {
  const { t } = useTranslation();
  const { login, completeTwoFactorLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Après connexion on revient là où l'utilisateur était (transmis via `from`
  // par la navbar ou ProtectedRoute). À défaut → accueil, jamais les settings ;
  // on évite aussi de reboucler sur les pages d'auth.
  const rawFrom = (location.state as { from?: string } | null)?.from;
  const from = rawFrom && !['/login', '/signup'].includes(rawFrom) ? rawFrom : '/';
  const oauthError = searchParams.get('error');
  const OAUTH_ERROR_MESSAGES: Record<string, string> = {
    email_in_use: t('auth.login.errorEmailInUse'),
  };
  const oauthErrorMessage = oauthError
    ? (OAUTH_ERROR_MESSAGES[oauthError] ?? t('auth.login.errorGeneric'))
    : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [code, setCode] = useState('');
  // The Steam callback lands here with ?steam=failed when OpenID verification
  // fails (cancelled login, bad assertion…)
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('steam') === 'failed' ? t('auth.login.steamFailed') : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result?.requiresTwoFactor) {
        setNeedsTwoFactor(true);
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.login.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await completeTwoFactorLogin(code);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.twoFactor.invalidCode'));
    } finally {
      setSubmitting(false);
    }
  }

  if (needsTwoFactor) {
    return (
      <AuthShell>
        <h1 className="text-center font-display text-lg font-bold tracking-tight">
          {t('auth.twoFactor.title')}
        </h1>
        <p className="mb-5 mt-1 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('auth.twoFactor.description')}
        </p>
        <form onSubmit={handleCodeSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            placeholder="123456"
            aria-label={t('auth.twoFactor.title')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="field px-4 py-2.5 text-center tracking-[0.4em]"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-1 rounded-full bg-accent px-5 py-2.5 font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? t('auth.twoFactor.verifying') : t('auth.twoFactor.verify')}
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell active="login" subtitle={t('auth.login.subtitle')}>
      {oauthErrorMessage && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {oauthErrorMessage}
        </p>
      )}
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder={t('auth.login.emailPlaceholder')}
          aria-label={t('auth.login.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field px-4 py-2.5"
        />
        <input
          type="password"
          required
          placeholder={t('auth.login.passwordPlaceholder')}
          aria-label={t('auth.login.passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field px-4 py-2.5"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="text-right">
          <Link
            to="/forgot-password"
            className="text-sm text-zinc-500 underline-offset-2 transition hover:text-accent dark:text-zinc-400"
          >
            {t('auth.login.forgotPassword')}
          </Link>
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-full bg-accent px-5 py-2.5 font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-sm text-zinc-500">
        <div className="h-px flex-1 bg-zinc-900/10 dark:bg-zinc-100/10" />
        {t('oauth.or')}
        <div className="h-px flex-1 bg-zinc-900/10 dark:bg-zinc-100/10" />
      </div>

      <OAuthButtons />

      <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('auth.login.noAccount')}{' '}
        <Link to="/signup" className="font-semibold text-accent hover:brightness-110">
          {t('auth.login.signupLink')}
        </Link>
      </p>
    </AuthShell>
  );
}
