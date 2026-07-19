import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

type Status = 'pending' | 'success' | 'error';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  // No token in the URL: start straight in the error state instead of
  // setState-ing synchronously inside the effect (react-hooks rule)
  const [status, setStatus] = useState<Status>(token ? 'pending' : 'error');
  const [error, setError] = useState<string | null>(
    token ? null : 'Missing verification token.',
  );

  useEffect(() => {
    if (!token) return;
    apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setError(err instanceof ApiError ? err.message : 'Verification failed');
      });
  }, [token]);

  return (
    <div className="mx-auto max-w-sm text-center">
      {status === 'pending' && <p className="text-zinc-400">Verifying your email…</p>}
      {status === 'success' && (
        <>
          <h1 className="mb-4 text-2xl font-bold">Email verified</h1>
          <p className="mb-6 text-zinc-400">Your address is confirmed — you're all set.</p>
          <Link to="/profile" className="underline">
            Go to your profile
          </Link>
        </>
      )}
      {status === 'error' && (
        <>
          <h1 className="mb-4 text-2xl font-bold text-red-400">Verification failed</h1>
          <p className="mb-6 text-zinc-400">{error}</p>
          <Link to="/profile" className="underline">
            Back to your profile
          </Link>
        </>
      )}
    </div>
  );
}
