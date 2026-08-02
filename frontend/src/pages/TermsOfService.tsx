import { useTranslation } from 'react-i18next';
import LegalSection from '../components/LegalSection';

const SECTIONS = [
  'purpose',
  'account',
  'credentials',
  'acceptableUse',
  'abuse',
  'interactions',
  'moderation',
  'suspension',
  'userContent',
  'intellectualProperty',
  'gameContent',
  'availability',
  'liability',
  'thirdPartiesAuth',
  'changes',
  'law',
  'contact',
] as const;

export default function TermsOfService() {
  const { t } = useTranslation();
  return (
    <article className="prose prose-invert mx-auto max-w-3xl">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">{t('legal.terms.title')}</h1>
      <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">{t('legal.terms.lastUpdated')}</p>
      <p className="text-zinc-300">{t('legal.terms.intro')}</p>
      {SECTIONS.map((key) => (
        <LegalSection
          key={key}
          titleKey={`legal.terms.sections.${key}.title`}
          bodyKey={`legal.terms.sections.${key}.body`}
        />
      ))}
    </article>
  );
}
