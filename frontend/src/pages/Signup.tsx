import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import AuthShell from '../components/AuthShell';
import OAuthButtons from '../components/OAuthButtons';
import { trackEvent } from '../lib/analytics';
import { apiFetch, ApiError } from '../lib/api';

// Steam personas allow spaces/emojis ours don't — prefill what we can.
function sanitizeUsername(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);
}

export default function Signup() {
  const { t } = useTranslation();
  const { signup, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // From the Steam callback: steamId arrives in an httpOnly cookie (no email), user finishes here.
  const steamPending = params.get('steam') === 'pending';

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState(() =>
    steamPending ? sanitizeUsername(params.get('name') ?? '') : '',
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (steamPending) {
        await apiFetch('/auth/steam/register', {
          method: 'POST',
          body: JSON.stringify({ email, username, ...(password ? { password } : {}) }),
        });
        await refreshUser();
      } else {
        await signup(email, password);
      }
      trackEvent('signup');
      navigate('/welcome', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setExpired(steamPending && err.status === 401);
      } else {
        setError(t('auth.signup.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      active={steamPending ? undefined : 'signup'}
      subtitle={steamPending ? undefined : t('auth.signup.subtitle')}
    >
      {steamPending && (
        <>
          <h1 className="text-center font-display text-lg font-bold tracking-tight">
            {t('auth.signup.titleSteam')}
          </h1>
          <p className="mb-5 mt-1 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t('auth.signup.steamIntro')}
          </p>
        </>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder={t('auth.signup.emailPlaceholder')}
          aria-label={t('auth.signup.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field px-4 py-2.5"
        />
        {steamPending && (
          <input
            type="text"
            required
            minLength={3}
            maxLength={24}
            pattern="[a-zA-Z0-9_]+"
            title={t('auth.signup.usernameHint')}
            placeholder={t('auth.signup.usernamePlaceholder')}
            aria-label={t('auth.signup.usernamePlaceholder')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="field px-4 py-2.5"
          />
        )}
        <input
          type="password"
          required={!steamPending}
          minLength={8}
          placeholder={steamPending ? t('auth.signup.passwordPlaceholderSteam') : t('auth.signup.passwordPlaceholder')}
          aria-label={steamPending ? t('auth.signup.passwordPlaceholderSteam') : t('auth.signup.passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field px-4 py-2.5"
        />
        {steamPending && (
          <p className="-mt-1 text-xs text-zinc-500">{t('auth.signup.passwordHintSteam')}</p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {expired && (
          <a href="/api/auth/steam" className="text-sm text-accent underline">
            {t('auth.signup.sessionExpired')}
          </a>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-full bg-accent px-5 py-2.5 font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting
            ? t('auth.signup.submitting')
            : steamPending
              ? t('auth.signup.submitSteam')
              : t('auth.signup.submit')}
        </button>
      </form>

      {!steamPending && (
        <>
          <div className="my-6 flex items-center gap-3 text-sm text-zinc-500">
            <div className="h-px flex-1 bg-zinc-900/10 dark:bg-zinc-100/10" />
            {t('oauth.or')}
            <div className="h-px flex-1 bg-zinc-900/10 dark:bg-zinc-100/10" />
          </div>

          <OAuthButtons />
        </>
      )}

      <p className="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('auth.signup.alreadyHaveAccount')}{' '}
        <Link to="/login" className="font-semibold text-accent hover:brightness-110">
          {t('auth.signup.loginLink')}
        </Link>
      </p>
    </AuthShell>
  );
}
