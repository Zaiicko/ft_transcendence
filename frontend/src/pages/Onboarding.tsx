import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import AvatarFramer from '../components/AvatarFramer';
import PsnConnectModal from '../components/PsnConnectModal';
import XboxConnectModal from '../components/XboxConnectModal';
import { LanguageCode, loadLanguage, SUPPORTED_LANGUAGES } from '../i18n';
import { apiFetch, ApiError } from '../lib/api';

// Wizard de bienvenue affiché juste après l'inscription (voir ProtectedRoute :
// tant que user.onboarded est faux, toute page protégée y renvoie). 3 étapes :
// pseudo (pré-rempli par le service), photo (AvatarFramer, pré-remplie par le
// service), liaison des comptes de jeu. « Terminer » et « Passer » posent
// onboardedAt côté back (POST /users/me/onboarded) → plus de redirection auto.

const STEP_KEY = 'onboardingStep';
const TOTAL_STEPS = 3;

// Logos officiels (Simple Icons, CC0) pour les cartes de services.
const STEAM_PATH =
  'M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z';
const XBOX_PATH =
  'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z';
const PLAYSTATION_PATH =
  'M8.984 2.596v17.547l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.18.76.814.76 1.505v5.875c2.441 1.193 4.362-.002 4.362-3.152 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.39-1.502zm4.656 16.241l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.205 1.5V14.98l.24-.085s1.201-.42 2.913-.615c1.696-.18 3.785.03 5.437.661 1.848.601 2.04 1.472 1.576 2.072-.465.6-1.622 1.036-1.622 1.036l-8.544 3.107V18.86zM1.807 18.6c-1.9-.545-2.214-1.668-1.352-2.32.801-.586 2.16-1.052 2.16-1.052l5.615-2.013v2.313L4.205 17c-.705.271-.825.632-.239.826.586.195 1.637.15 2.343-.12L8.247 17v2.074c-.12.03-.256.044-.39.073-1.939.331-3.996.196-6.038-.479z';

function ServiceIcon({ color, path }: { color: string; path: string }) {
  return (
    <span
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ring-1 ring-black/10 dark:ring-white/10"
      style={{ backgroundColor: color }}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
    </span>
  );
}

const pill =
  'rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm font-medium transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-zinc-600';

// Sélecteur de langue du welcome : applique le choix IMMÉDIATEMENT (contrairement
// au sélecteur du menu qui n'applique qu'à la fermeture), pour que le reste du
// wizard ET le tour guidé lancé juste après soient dans la langue choisie.
// Persistance : localStorage (i18next) + profil (best-effort).
function OnboardingLanguagePicker() {
  const { t, i18n } = useTranslation();
  const { user, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const code = (i18n.resolvedLanguage ?? i18n.language ?? 'en') as LanguageCode;
  const current = SUPPORTED_LANGUAGES.find((l) => l.code === code) ?? SUPPORTED_LANGUAGES[0];

  const choose = async (next: LanguageCode) => {
    setOpen(false);
    if (next === current.code) return;
    await loadLanguage(next); // charge la locale (lazy) avant de basculer
    await i18n.changeLanguage(next);
    if (user) {
      apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ language: next }) })
        .then(() => refreshUser())
        .catch(() => {});
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-zinc-400/60 px-3 py-1.5 text-sm transition hover:border-accent hover:text-accent dark:border-zinc-600"
      >
        <span aria-hidden="true">{current.flag}</span>
        <span className="hidden sm:inline">{current.name}</span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current stroke-2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={t('common.close')}
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <ul
            role="menu"
            className="absolute right-0 z-20 mt-2 grid w-60 grid-cols-2 gap-1 rounded-lg border border-zinc-900/10 bg-white p-1 shadow-lg dark:border-zinc-100/10 dark:bg-zinc-900"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <li key={lang.code}>
                <button
                  type="button"
                  onClick={() => choose(lang.code)}
                  aria-pressed={lang.code === current.code}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition ${
                    lang.code === current.code
                      ? 'bg-accent font-medium text-zinc-950'
                      : 'hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10'
                  }`}
                >
                  <span aria-hidden="true">{lang.flag}</span>
                  {lang.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default function Onboarding() {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  // On reprend à l'étape mémorisée (retour de liaison Steam / page quittée).
  const [step, setStep] = useState<number>(() => {
    const saved = Number(sessionStorage.getItem(STEP_KEY));
    return saved >= 1 && saved <= TOTAL_STEPS ? saved : 1;
  });
  const [username, setUsername] = useState(user?.username ?? '');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [psnModalOpen, setPsnModalOpen] = useState(false);
  const [xboxModalOpen, setXboxModalOpen] = useState(false);

  useEffect(() => {
    sessionStorage.setItem(STEP_KEY, String(step));
  }, [step]);

  if (!user) return null;

  function goTo(next: number) {
    setUsernameError(null);
    setStep(next);
  }

  async function saveUsername(e: FormEvent) {
    e.preventDefault();
    setUsernameError(null);
    // Pseudo inchangé : on ne rappelle pas l'API.
    if (username === user!.username) {
      goTo(2);
      return;
    }
    setSavingUsername(true);
    try {
      await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ username }) });
      await refreshUser();
      goTo(2);
    } catch (err) {
      setUsernameError(err instanceof ApiError ? err.message : t('onboarding.genericError'));
    } finally {
      setSavingUsername(false);
    }
  }

  // Pose onboardedAt puis quitte le wizard. Utilisé par « Terminer » et par le
  // « Passer » global : dans les deux cas l'utilisateur ne sera plus redirigé
  // ici automatiquement (il devra repasser par les réglages).
  async function finish() {
    setFinishing(true);
    try {
      await apiFetch('/users/me/onboarded', { method: 'POST' });
      await refreshUser();
      sessionStorage.removeItem(STEP_KEY);
      navigate('/', { replace: true });
    } catch {
      // En cas d'échec réseau on laisse l'utilisateur sur place plutôt que de le
      // bloquer : il pourra réessayer.
      setFinishing(false);
    }
  }

  const services: {
    key: string;
    label: string;
    icon: ReactNode;
    linked: boolean;
    perks: string[];
    linkHref?: string;
    onLink?: () => void;
  }[] = [
    {
      key: 'steam',
      label: 'Steam',
      icon: <ServiceIcon color="#1b2838" path={STEAM_PATH} />,
      linked: !!user.steamId,
      perks: t('onboarding.services.steam.perks', { returnObjects: true }) as string[],
      linkHref: '/api/auth/steam',
    },
    {
      key: 'playstation',
      label: 'PlayStation',
      icon: <ServiceIcon color="#003791" path={PLAYSTATION_PATH} />,
      linked: user.psnLinked,
      perks: t('onboarding.services.playstation.perks', { returnObjects: true }) as string[],
      onLink: () => setPsnModalOpen(true),
    },
    {
      key: 'xbox',
      label: 'Xbox',
      icon: <ServiceIcon color="#107C10" path={XBOX_PATH} />,
      linked: user.xboxLinked,
      perks: t('onboarding.services.xbox.perks', { returnObjects: true }) as string[],
      onLink: () => setXboxModalOpen(true),
    },
  ];

  return (
    <div className="mx-auto max-w-lg py-6">
      {/* En-tête : titre de bienvenue + choix de la langue (pour que la suite,
          y compris le tour guidé qui démarre après, soit dans ta langue). */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('onboarding.welcome')}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('onboarding.subtitle')}</p>
        </div>
        <OnboardingLanguagePicker />
      </div>

      {/* Barre de progression */}
      <div className="mb-8 flex items-center gap-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={`h-1.5 flex-1 rounded-full transition ${
              n <= step ? 'bg-accent' : 'bg-zinc-200 dark:bg-zinc-800'
            }`}
          />
        ))}
      </div>

      <div className="card p-6">
        {/* Étape 1 — Pseudo */}
        {step === 1 && (
          <form onSubmit={saveUsername} className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t('onboarding.username.title')}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {t('onboarding.username.subtitle')}
              </p>
            </div>
            <input
              type="text"
              required
              minLength={3}
              maxLength={24}
              pattern="[a-zA-Z0-9_]+"
              title={t('onboarding.username.hint')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="field px-4 py-2"
            />
            <p className="-mt-2 text-xs text-zinc-500">{t('onboarding.username.hint')}</p>
            {usernameError && <p className="text-sm text-red-400">{usernameError}</p>}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingUsername}
                className="rounded-full bg-accent px-6 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
              >
                {savingUsername ? t('common.saving') : t('onboarding.next')}
              </button>
            </div>
          </form>
        )}

        {/* Étape 2 — Photo de profil (réutilise AvatarFramer, pré-rempli par le
            service). Save/Cancel du framer avancent tous deux à l'étape 3. */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t('onboarding.avatar.title')}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {t('onboarding.avatar.subtitle')}
              </p>
            </div>
            <AvatarFramer avatarUrl={user.avatarUrl} onClose={() => goTo(3)} />
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => goTo(1)}
                className="text-sm text-zinc-500 underline transition hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                {t('onboarding.back')}
              </button>
              <button
                type="button"
                onClick={() => goTo(3)}
                className="text-sm text-zinc-500 underline transition hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                {t('onboarding.avatar.skip')}
              </button>
            </div>
          </div>
        )}

        {/* Étape 3 — Liaison des comptes de jeu */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold">{t('onboarding.services.title')}</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {t('onboarding.services.subtitle')}
              </p>
            </div>

            {/* Avertissement bien visible, valable pour les 3 services : sans
                profil public, aucun import possible. */}
            <div className="flex items-start gap-3 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              <svg
                viewBox="0 0 24 24"
                className="mt-0.5 h-5 w-5 shrink-0 fill-none stroke-current"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="font-medium">{t('onboarding.services.publicNotice')}</span>
            </div>

            <ul className="flex flex-col gap-3">
              {services.map((s) => (
                <li
                  key={s.key}
                  className="flex items-start gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
                >
                  {s.icon}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.label}</span>
                      {s.linked && (
                        <span className="text-xs text-green-600 dark:text-green-400">
                          ✓ {t('onboarding.services.connected')}
                        </span>
                      )}
                    </div>
                    <ul className="mt-1 list-inside list-disc text-sm text-zinc-500 dark:text-zinc-400">
                      {s.perks.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                  {!s.linked &&
                    (s.linkHref ? (
                      <a href={s.linkHref} className={`${pill} shrink-0`}>
                        {t('onboarding.services.connect')}
                      </a>
                    ) : (
                      <button type="button" onClick={s.onLink} className={`${pill} shrink-0`}>
                        {t('onboarding.services.connect')}
                      </button>
                    ))}
                </li>
              ))}
            </ul>

            <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
              {t('onboarding.services.laterHint')}
            </p>

            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => goTo(2)}
                className="text-sm text-zinc-500 underline transition hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                {t('onboarding.back')}
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={finishing}
                className="rounded-full bg-accent px-6 py-2 font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
              >
                {finishing ? t('common.saving') : t('onboarding.finish')}
              </button>
            </div>
          </div>
        )}
      </div>

      {psnModalOpen && <PsnConnectModal onClose={() => setPsnModalOpen(false)} />}
      {xboxModalOpen && <XboxConnectModal onClose={() => setXboxModalOpen(false)} />}
    </div>
  );
}
