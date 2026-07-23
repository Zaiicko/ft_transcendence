import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">{t('errors.notFound.title')}</h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{t('errors.notFound.body')}</p>
      <Link
        to="/"
        className="inline-block rounded-full bg-accent px-5 py-2 font-medium text-zinc-950 transition hover:brightness-110"
      >
        {t('errors.notFound.home')}
      </Link>
    </div>
  );
}
