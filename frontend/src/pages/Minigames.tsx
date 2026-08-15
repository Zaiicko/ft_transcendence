import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import SectionHead from '../components/SectionHead';
import CoverGuessLogo from '../minigames/CoverGuessLogo';
import ScreenshotGuessLogo from '../minigames/ScreenshotGuessLogo';

export default function Minigames() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-8">
      <SectionHead eyebrow={t('minigames.hub.eyebrow')} title={t('minigames.hub.title')} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/minigames/cover-guess"
          className="card group flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:border-accent/50"
        >
          <CoverGuessLogo className="aspect-[3/4] w-16" />
          <span className="font-display text-lg font-bold tracking-tight">
            {t('minigames.coverGuess.title')}
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('minigames.coverGuess.description')}
          </span>
          <span className="mt-auto text-sm font-semibold text-accent">{t('minigames.hub.play')} →</span>
        </Link>
        <Link
          to="/minigames/screenshot-guess"
          className="card group flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:border-accent/50"
        >
          <ScreenshotGuessLogo className="aspect-[3/4] w-16" />
          <span className="font-display text-lg font-bold tracking-tight">
            {t('minigames.screenshotGuess.title')}
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('minigames.screenshotGuess.description')}
          </span>
          <span className="mt-auto text-sm font-semibold text-accent">{t('minigames.hub.play')} →</span>
        </Link>
      </div>
    </div>
  );
}
