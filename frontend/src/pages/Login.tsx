import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import OAuthButtons from '../components/OAuthButtons';
import { ApiError } from '../lib/api';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  email_in_use:
    'An account already exists with this email. Log in with your password instead, or use a different email for that provider.',
};

export default function Login() {
  const { login, completeTwoFactorLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const from = (location.state as { from?: string } | null)?.from ?? '/profile';
  const oauthError = searchParams.get('error');
  const oauthErrorMessage = oauthError
    ? (OAUTH_ERROR_MESSAGES[oauthError] ?? 'Something went wrong signing in — please try again.')
    : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [code, setCode] = useState('');
  // The Steam callback lands here with ?steam=failed when OpenID verification
  // fails (cancelled login, bad assertion…)
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('steam') === 'failed'
      ? 'Steam sign-in failed — please try again'
      : null,
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
      setError(err instanceof ApiError ? err.message : 'Login failed');
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
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setSubmitting(false);
    }
  }

  if (needsTwoFactor) {
    return (
      <div className="mx-auto max-w-sm">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Two-factor code</h1>
        <p className="mb-6 text-sm text-zinc-400">Enter the 6-digit code from your authenticator app.</p>
        <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-center tracking-widest"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Log in</h1>
      {oauthErrorMessage && (
        <p className="mb-4 rounded border border-red-900/50 bg-red-950/50 px-3 py-2 text-sm text-red-400">
          {oauthErrorMessage}
        </p>
      )}
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="mt-3 text-sm text-zinc-400">
        <Link to="/forgot-password" className="underline">
          Forgot your password?
        </Link>
      </p>

      <div className="my-6 flex items-center gap-3 text-zinc-500">
        <div className="h-px flex-1 bg-zinc-800" />
        or
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      <OAuthButtons />

      <p className="mt-6 text-sm text-zinc-400">
        No account?{' '}
        <Link to="/signup" className="underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
