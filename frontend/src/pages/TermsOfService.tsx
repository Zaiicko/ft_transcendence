import { useTranslation } from 'react-i18next';

// TODO(phase 4): replace with the full, project-specific terms of service.
// The evaluation rejects placeholder pages — this content must be completed
// before the defense (acceptable use, user content, moderation, liability...).
export default function TermsOfService() {
  const { t } = useTranslation();
  return (
    <article className="prose prose-invert mx-auto max-w-3xl">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">{t('legal.termsTitle')}</h1>
      <p className="text-zinc-300">{t('legal.termsBody1')}</p>
      <p className="mt-4 text-zinc-300">{t('legal.termsBody2')}</p>
    </article>
  );
}
