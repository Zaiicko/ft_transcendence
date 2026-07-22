import { useTranslation } from 'react-i18next';
import LegalSection from '../components/LegalSection';

const SECTIONS = [
  'dataCollected',
  'purposes',
  'discord',
  'retention',
  'rights',
  'cookies',
  'thirdParties',
  'contact',
] as const;

export default function PrivacyPolicy() {
  const { t } = useTranslation();
  return (
    <article className="prose prose-invert mx-auto max-w-3xl">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">{t('legal.privacy.title')}</h1>
      <p className="mb-8 text-sm text-zinc-500 dark:text-zinc-400">{t('legal.privacy.lastUpdated')}</p>
      <p className="text-zinc-300">{t('legal.privacy.intro')}</p>
      {SECTIONS.map((key) => (
        <LegalSection
          key={key}
          titleKey={`legal.privacy.sections.${key}.title`}
          bodyKey={`legal.privacy.sections.${key}.body`}
        />
      ))}
    </article>
  );
}
