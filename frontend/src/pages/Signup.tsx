import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import OAuthButtons from '../components/OAuthButtons';
import { apiFetch, ApiError } from '../lib/api';

// Steam personas allow spaces/emojis; our usernames don't. Prefill what we can
// and let the user adjust the rest.
function sanitizeUsername(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);
}

export default function Signup() {
  const { signup, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Arriving from the Steam callback: the verified steamId travels in an
  // httpOnly cookie, Steam gives no email — the user completes the account
  // here (username prefilled with their Steam persona, password optional).
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
        await signup(email, username, password);
      }
      navigate('/profile', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setExpired(steamPending && err.status === 401);
      } else {
        setError('Signup failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">
        {steamPending ? 'Finish your Steam sign-up' : 'Sign up'}
      </h1>
      {steamPending && (
        <p className="mb-6 text-sm text-zinc-400">
          Your Steam account is verified — pick an email and confirm your username to
          create your Saveboxd account.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        <input
          type="text"
          required
          minLength={3}
          maxLength={24}
          pattern="[a-zA-Z0-9_]+"
          title="Letters, numbers and underscores only"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        <input
          type="password"
          required={!steamPending}
          minLength={8}
          placeholder={steamPending ? 'Password (optional)' : 'Password (min. 8 characters)'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        {steamPending && (
          <p className="-mt-2 text-xs text-zinc-500">
            Without a password you will sign in with Steam only. You can add one later
            from your profile.
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {expired && (
          <a href="/api/auth/steam" className="text-sm underline">
            Session expired — sign in through Steam again
          </a>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : steamPending ? 'Create account' : 'Sign up'}
        </button>
      </form>

      {!steamPending && (
        <>
          <div className="my-6 flex items-center gap-3 text-zinc-500">
            <div className="h-px flex-1 bg-zinc-800" />
            or
            <div className="h-px flex-1 bg-zinc-800" />
          </div>

          <OAuthButtons />
        </>
      )}

      <p className="mt-6 text-sm text-zinc-400">
        Already have an account?{' '}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
