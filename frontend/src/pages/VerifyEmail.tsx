import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

type Status = 'pending' | 'success' | 'error';

export default function VerifyEmail() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  // No token in the URL: start straight in the error state instead of
  // setState-ing synchronously inside the effect (react-hooks rule)
  const [status, setStatus] = useState<Status>(token ? 'pending' : 'error');
  const [error, setError] = useState<string | null>(
    token ? null : t('auth.verifyEmail.missingToken'),
  );

  useEffect(() => {
    if (!token) return;
    apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error');
        setError(err instanceof ApiError ? err.message : t('auth.verifyEmail.genericError'));
      });
  }, [token, t]);

  return (
    <div className="mx-auto max-w-sm text-center">
      {status === 'pending' && <p className="text-zinc-400">{t('auth.verifyEmail.verifying')}</p>}
      {status === 'success' && (
        <>
          <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('auth.verifyEmail.successTitle')}</h1>
          <p className="mb-6 text-zinc-400">{t('auth.verifyEmail.successBody')}</p>
          <Link to="/profile" className="underline">
            {t('auth.verifyEmail.goToProfile')}
          </Link>
        </>
      )}
      {status === 'error' && (
        <>
          <h1 className="mb-4 text-2xl font-bold tracking-tight text-red-400">
            {t('auth.verifyEmail.failedTitle')}
          </h1>
          <p className="mb-6 text-zinc-400">{error}</p>
          <Link to="/profile" className="underline">
            {t('auth.verifyEmail.backToProfile')}
          </Link>
        </>
      )}
    </div>
  );
}
