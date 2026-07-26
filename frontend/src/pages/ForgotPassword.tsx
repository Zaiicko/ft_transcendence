import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.forgotPassword.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-sm text-center">
        <h1 className="mb-4 text-2xl font-bold tracking-tight">{t('auth.forgotPassword.checkEmailTitle')}</h1>
        <p className="text-zinc-400">{t('auth.forgotPassword.checkEmailBody')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('auth.forgotPassword.title')}</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          type="email"
          required
          placeholder={t('auth.forgotPassword.emailPlaceholder')}
          aria-label={t('auth.forgotPassword.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field px-4 py-1.5"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? t('auth.forgotPassword.submitting') : t('auth.forgotPassword.submit')}
        </button>
      </form>
      <p className="mt-6 text-sm text-zinc-400">
        <Link to="/login" className="underline">
          {t('auth.forgotPassword.backToLogin')}
        </Link>
      </p>
    </div>
  );
}
