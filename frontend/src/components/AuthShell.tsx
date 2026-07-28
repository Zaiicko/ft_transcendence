import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

// Cadre commun des pages Connexion / Inscription : fond ambiant ambre + carte
// brandée (logo + wordmark Saveboxd) et, en mode normal, un sélecteur segmenté
// Connexion/Inscription. `active` absent (flux 2FA / Steam) = pas d'onglets.
export default function AuthShell({
  active,
  subtitle,
  children,
}: {
  active?: 'login' | 'signup';
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const tab = (on: boolean) =>
    `rounded-lg py-2 text-center text-sm font-semibold transition ${
      on
        ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;

  return (
    <div className="relative mx-auto flex max-w-md flex-col justify-center py-6">
      {/* Halos ambiants ambre — sans overflow-hidden pour que le flou se fonde
          au lieu d'être coupé net au bord (arête droite). */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 -top-8 h-52 w-72 -translate-x-1/2 rounded-full bg-accent/20 blur-[80px]" />
        <div className="absolute -bottom-10 right-2 h-52 w-52 rounded-full bg-accent/10 blur-[80px]" />
      </div>

      <div className="card p-7 shadow-xl sm:p-8">
        {/* Marque */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-300 to-accent text-zinc-950 shadow-lg shadow-accent/40">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-none stroke-current"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 7v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7M4 7l2-3h12l2 3M9 12h6" />
            </svg>
          </span>
          <span className="font-display text-xl font-bold tracking-tight">
            <span className="text-accent">Save</span>boxd
          </span>
        </div>

        {/* Sélecteur Connexion / Inscription */}
        {active && (
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-zinc-900/10 bg-zinc-900/[0.03] p-1 dark:border-zinc-100/10 dark:bg-zinc-100/[0.04]">
            <Link to="/login" className={tab(active === 'login')}>
              {t('auth.login.title')}
            </Link>
            <Link to="/signup" className={tab(active === 'signup')}>
              {t('auth.signup.title')}
            </Link>
          </div>
        )}

        {subtitle && (
          <p className="mb-5 text-center text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        )}

        {children}
      </div>
    </div>
  );
}
