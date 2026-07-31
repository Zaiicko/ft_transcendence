import { ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from './Avatar';
import ChatWidget from './ChatWidget';
import LanguageSwitcher from './LanguageSwitcher';
import NotificationBell from './NotificationBell';
import { BellIcon, NotificationPrefsList } from './NotificationSettings';
import { applyMode, storedMode, ThemeMode } from '../lib/theme';
import { apiFetch } from '../lib/api';
import SearchBar from './SearchBar';
import Tutorial from './Tutorial';

// Icônes filaires fines (trait 1.6, style TiMN) — remplacent les emojis
function Icon({ children, className = 'h-4 w-4' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${className} shrink-0 fill-none stroke-current`}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const gearIcon = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
);

const sunIcon = (
  <>
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </>
);

const moonIcon = <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />;

const helpIcon = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
    <path d="M12 17h.01" />
  </>
);

const menuIcon = (
  <>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </>
);

const globeIcon = (
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </>
);

const logoutIcon = (
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>
);

// Liens de nav façon TiMN : gris discret, la page active porte un fin
// soulignement ambre sous la barre
const navLink = ({ isActive }: { isActive: boolean }) =>
  `relative transition ${
    isActive
      ? 'text-zinc-900 after:absolute after:-bottom-2 after:left-0 after:right-0 after:h-[1.5px] after:bg-accent dark:text-zinc-100'
      : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
  }`;

export default function Layout() {
  const { t } = useTranslation();
  const { user, loading, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<ThemeMode>(storedMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [notifPrefsOpen, setNotifPrefsOpen] = useState(false);
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // Empêche le tuto de se relancer tout seul dans la même session après qu'on
  // l'a fermé (le champ tutorialSeen ne passe true qu'après le POST).
  const tourAutoStarted = useRef(false);

  // Referme le menu burger à chaque changement de page — comparé pendant le
  // rendu plutôt que dans un effet (setState synchrone dans un effet
  // déclenche un rendu en cascade, voir react-hooks/set-state-in-effect)
  const [lastPathname, setLastPathname] = useState(location.pathname);
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname);
    setNavOpen(false);
  }

  // Synchronise la classe .dark de <html> (et localStorage) avec l'état React
  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  // Garde d'onboarding global : un nouvel inscrit qui n'a pas terminé (ni
  // explicitement passé) le wizard est ramené sur /welcome, y compris à la
  // réouverture du site sur une page publique (accueil…) — ProtectedRoute ne
  // couvre que les pages protégées.
  useEffect(() => {
    if (!loading && user && !user.onboarded && location.pathname !== '/welcome') {
      navigate('/welcome', { replace: true });
    }
  }, [loading, user, location.pathname, navigate]);

  // Échap ferme tout menu / fenêtre ouvert (WCAG 2.1.2 — pas de piège clavier).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      setNavOpen(false);
      setNotifPrefsOpen(false);
      setLanguagePickerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  // Lancement automatique du tour guidé : une fois l'onboarding terminé et tant
  // que le tuto n'a pas été vu. Une seule fois par session (garde tourAutoStarted),
  // pas sur le wizard lui-même.
  useEffect(() => {
    if (loading || !user) return;
    if (user.onboarded && !user.tutorialSeen && !tourAutoStarted.current) {
      tourAutoStarted.current = true;
      setTourOpen(true);
    }
  }, [loading, user]);

  // Fin/passage du tour : pose tutorialSeen côté back (idempotent) puis referme.
  async function handleTutorialClose() {
    setTourOpen(false);
    try {
      await apiFetch('/users/me/tutorial-seen', { method: 'POST' });
      await refreshUser();
    } catch {
      // Silencieux : au pire le tuto se reproposera plus tard.
    }
  }

  return (
    <div className="flex min-h-screen flex-col text-zinc-900 dark:text-zinc-100">
      {/* Skip link (WCAG 2.4.1) : 1er élément tabulable, masqué jusqu'au focus,
          saute la navigation pour aller droit au contenu. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:font-medium focus:text-zinc-950"
      >
        {t('a11y.skipToContent')}
      </a>
      <header className="sticky top-0 z-40 border-b border-zinc-900/10 bg-zinc-50/80 px-4 pb-4 pt-5 backdrop-blur-md sm:px-6 dark:border-zinc-100/10 dark:bg-zinc-950/80">
        <nav className="mx-auto flex max-w-6xl 2xl:max-w-7xl 3xl:max-w-[100rem] 4xl:max-w-[130rem] 5xl:max-w-[180rem] items-center gap-3 sm:gap-6">
          {/* Burger : liens de nav sur petit/moyen écran (la barre inline est
              masquée < lg — trop chargée en dessous : 5 liens + recherche + icônes) */}
          <div className="relative shrink-0 lg:hidden">
            <button
              type="button"
              onClick={() => setNavOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={navOpen}
              aria-label={t('menu.navigation')}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
            >
              <Icon className="h-5 w-5">{menuIcon}</Icon>
            </button>
            {navOpen && (
              <>
                <button
                  type="button"
                  aria-label={t('menu.closeMenu')}
                  tabIndex={-1}
                  onClick={() => setNavOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div
                  role="menu"
                  className="absolute left-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-zinc-900/10 bg-white py-1 text-sm shadow-lg dark:border-zinc-100/10 dark:bg-zinc-900"
                >
                  <NavLink
                    to="/games"
                    role="menuitem"
                    onClick={() => setNavOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                  >
                    {t('nav.catalog')}
                  </NavLink>
                  {user && (
                    <>
                      <NavLink
                        to="/feed"
                        role="menuitem"
                        onClick={() => setNavOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                      >
                        {t('nav.feed')}
                      </NavLink>
                      <NavLink
                        to="/leaderboard"
                        role="menuitem"
                        onClick={() => setNavOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                      >
                        {t('nav.leaderboard')}
                      </NavLink>
                      <NavLink
                        to="/friends"
                        role="menuitem"
                        onClick={() => setNavOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                      >
                        {t('nav.friends')}
                      </NavLink>
                      <NavLink
                        to="/library"
                        role="menuitem"
                        onClick={() => setNavOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                      >
                        {t('nav.library')}
                      </NavLink>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <Link data-tour="home" to="/" className="font-display flex shrink-0 items-baseline gap-2 text-xl font-bold tracking-tight">
            <span>
              <span className="text-accent">Save</span>boxd
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              beta
            </span>
          </Link>
          {/* Le nom du site (à gauche) renvoie déjà à l'accueil — pas de lien
              "Home" redondant */}
          <div className="hidden items-center gap-7 text-sm lg:flex">
            <NavLink data-tour="catalog" to="/games" className={navLink}>
              {t('nav.catalog')}
            </NavLink>
            {user && (
              <>
                <NavLink data-tour="feed" to="/feed" className={navLink}>
                  {t('nav.feed')}
                </NavLink>
                <NavLink data-tour="leaderboard" to="/leaderboard" className={navLink}>
                  {t('nav.leaderboard')}
                </NavLink>
                <NavLink data-tour="friends" to="/friends" className={navLink}>
                  {t('nav.friends')}
                </NavLink>
                <NavLink data-tour="library" to="/steam" className={navLink}>
                  {t('nav.library')}
                </NavLink>
              </>
            )}
          </div>
          <div data-tour="search" className="ml-auto w-32 min-w-0 sm:w-44 lg:w-56">
            <SearchBar />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-4">
            {user ? (
              <>
                <span data-tour="notifications" className="flex items-center">
                  <NotificationBell />
                </span>
                <Link
                  data-tour="profile"
                  to={`/u/${user.username}`}
                  className="flex min-w-0 items-center gap-2 hover:opacity-70"
                >
                  <Avatar username={user.username} avatarUrl={user.avatarUrl} size={24} />
                  <span className="hidden max-w-[8rem] truncate md:inline">{user.username}</span>
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  state={{ from: location.pathname + location.search }}
                  className="text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  {t('nav.login')}
                </Link>
                <Link
                  to="/signup"
                  className="rounded-full border border-zinc-400/60 px-4 py-1.5 transition hover:border-accent hover:text-accent dark:border-zinc-600"
                >
                  {t('nav.signup')}
                </Link>
              </>
            )}

            {/* Gear dropdown: day/night toggle for everyone; settings + logout when signed in */}
            <div className="relative">
              <button
                data-tour="menu"
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Menu"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-400/60 text-zinc-500 transition hover:border-accent hover:text-accent dark:border-zinc-600 dark:text-zinc-400"
              >
                <Icon>{gearIcon}</Icon>
              </button>
              {menuOpen && (
                <>
                  {/* Full-screen catcher so any outside click closes the menu */}
                  <button
                    type="button"
                    aria-label={t('menu.closeMenu')}
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-zinc-900/10 bg-white py-1 shadow-lg dark:border-zinc-100/10 dark:bg-zinc-900"
                  >
                    {user && (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            setNotifPrefsOpen(true);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                        >
                          <BellIcon className="h-4 w-4" /> {t('menu.notifications')}
                        </button>
                        <Link
                          to="/settings"
                          role="menuitem"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                        >
                          <Icon>{gearIcon}</Icon> {t('menu.settings')}
                        </Link>
                      </>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setLanguagePickerOpen(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                    >
                      <Icon>{globeIcon}</Icon> {t('menu.language')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                    >
                      <Icon>{mode === 'dark' ? sunIcon : moonIcon}</Icon>
                      {mode === 'dark' ? t('menu.lightMode') : t('menu.darkMode')}
                    </button>
                    {user && (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            setTourOpen(true);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                        >
                          <Icon>{helpIcon}</Icon> {t('menu.replayTutorial')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleLogout}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                        >
                          <Icon>{logoutIcon}</Icon> {t('menu.logout')}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl 2xl:max-w-7xl 3xl:max-w-[100rem] 4xl:max-w-[130rem] 5xl:max-w-[180rem] flex-1 px-6 py-8 focus:outline-none">
        {/* Fallback pendant le téléchargement d'une page lazy (voir App.tsx) :
            la nav reste affichée, seul le contenu montre le spinner. */}
        <Suspense
          fallback={
            <div className="flex min-h-[40vh] items-center justify-center" aria-busy="true">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-accent dark:border-zinc-700" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      {/* Privacy Policy and ToS must be reachable from the footer (subject requirement) */}
      <footer className="mt-10 border-t border-zinc-900/10 px-6 py-8 dark:border-zinc-100/10">
        <div className="mx-auto flex max-w-6xl 2xl:max-w-7xl 3xl:max-w-[100rem] 4xl:max-w-[130rem] 5xl:max-w-[180rem] flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <Link to="/" className="font-display text-lg font-bold tracking-tight">
              <span className="text-accent">Save</span>boxd
            </Link>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('footer.tagline')}</p>
          </div>
          <nav className="flex items-center gap-6 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Link to="/privacy-policy" className="transition hover:text-accent">
              {t('footer.privacy')}
            </Link>
            <Link to="/terms-of-service" className="transition hover:text-accent">
              {t('footer.terms')}
            </Link>
            <span className="font-normal normal-case text-zinc-400 dark:text-zinc-600">
              © {new Date().getFullYear()}
            </span>
          </nav>
        </div>
      </footer>

      {/* Fenêtre de préférences de notifications (ouverte depuis le menu rouage) */}
      {notifPrefsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/40 p-4 pt-20 backdrop-blur-sm"
          onClick={() => setNotifPrefsOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('menu.notificationPrefs')}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-zinc-900/10 bg-white p-5 shadow-2xl dark:border-zinc-100/10 dark:bg-zinc-900"
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <BellIcon className="h-5 w-5" /> Notifications
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setNotifPrefsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-100/10 dark:hover:text-zinc-100"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t('notifications.prefsDescription')}</p>
            <NotificationPrefsList />
          </div>
        </div>
      )}

      {/* Fenêtre du sélecteur de langue (ouverte depuis le menu rouage) */}
      {languagePickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/40 p-4 pt-20 backdrop-blur-sm"
          onClick={() => setLanguagePickerOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('languagePicker.title')}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-xl border border-zinc-900/10 bg-white p-5 shadow-2xl dark:border-zinc-100/10 dark:bg-zinc-900"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <Icon className="h-5 w-5">{globeIcon}</Icon> {t('languagePicker.title')}
              </h2>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setLanguagePickerOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-100/10 dark:hover:text-zinc-100"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <LanguageSwitcher />
          </div>
        </div>
      )}

      {/* Messagerie flottante (bas-droite) — montée uniquement si connecté :
          sinon l'effet de ChatWidget appelle /chat/conversations → 401. */}
      {user && <ChatWidget />}

      {/* Tour guidé « à quoi sert chaque bouton » (auto après onboarding, ou
          relancé depuis le menu réglages). */}
      {user && <Tutorial open={tourOpen} onClose={handleTutorialClose} />}
    </div>
  );
}
