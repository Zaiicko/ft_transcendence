import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) {
      setError(t('auth.resetPassword.missingToken'));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: password }),
      });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.resetPassword.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-sm text-center">
        <h1 className="mb-4 text-2xl font-bold tracking-tight text-red-400">
          {t('auth.resetPassword.invalidLinkTitle')}
        </h1>
        <p className="mb-6 text-zinc-400">{t('auth.resetPassword.invalidLinkBody')}</p>
        <Link to="/forgot-password" className="underline">
          {t('auth.resetPassword.requestNewLink')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('auth.resetPassword.title')}</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="password"
          required
          minLength={8}
          placeholder={t('auth.resetPassword.newPasswordPlaceholder')}
          aria-label={t('auth.resetPassword.newPasswordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field px-4 py-1.5"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? t('auth.resetPassword.submitting') : t('auth.resetPassword.submit')}
        </button>
      </form>
    </div>
  );
}
