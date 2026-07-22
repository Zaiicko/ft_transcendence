import { useTranslation } from 'react-i18next';

// TODO(phase 4): replace with the full, project-specific privacy policy.
// The evaluation rejects placeholder pages — this content must be completed
// before the defense (data collected, purpose, retention, user rights, etc.).
export default function PrivacyPolicy() {
  const { t } = useTranslation();
  return (
    <article className="prose prose-invert mx-auto max-w-3xl">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">{t('legal.privacyTitle')}</h1>
      <p className="text-zinc-300">{t('legal.privacyBody1')}</p>
      <p className="mt-4 text-zinc-300">{t('legal.privacyBody2')}</p>
    </article>
  );
}
