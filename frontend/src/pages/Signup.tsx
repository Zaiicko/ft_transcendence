import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(email, username, password);
      navigate('/profile', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Sign up</h1>
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
          required
          minLength={8}
          placeholder="Password (min. 8 characters)"
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
          {submitting ? 'Creating account…' : 'Sign up'}
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
      </div>

      <p className="mt-6 text-sm text-zinc-400">
        Already have an account?{' '}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
