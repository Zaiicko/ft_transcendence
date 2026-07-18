import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/profile';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The Steam callback lands here with ?steam=failed when OpenID verification
  // fails (cancelled login, bad assertion…)
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('steam') === 'failed'
      ? 'Steam sign-in failed — please try again'
      : null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Log in</h1>
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
          className="rounded bg-zinc-100 px-3 py-2 font-medium text-zinc-950 disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-zinc-500">
        <div className="h-px flex-1 bg-zinc-800" />
        or
        <div className="h-px flex-1 bg-zinc-800" />
      </div>

      <div className="flex flex-col gap-3">
        <a href="/api/auth/google" className="rounded border border-zinc-700 px-3 py-2 text-center hover:bg-zinc-900">
          Continue with Google
        </a>
        <a href="/api/auth/42" className="rounded border border-zinc-700 px-3 py-2 text-center hover:bg-zinc-900">
          Continue with 42
        </a>
        <a href="/api/auth/steam" className="rounded border border-zinc-700 px-3 py-2 text-center hover:bg-zinc-900">
          Continue with Steam
        </a>
      </div>

      <p className="mt-6 text-sm text-zinc-400">
        No account?{' '}
        <Link to="/signup" className="underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
