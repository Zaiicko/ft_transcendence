import { ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { applyMode, storedMode, ThemeMode } from '../lib/theme';
import SearchBar from './SearchBar';

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
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<ThemeMode>(storedMode);
  const [menuOpen, setMenuOpen] = useState(false);

  // Synchronise la classe .dark de <html> (et localStorage) avec l'état React
  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="flex min-h-screen flex-col text-zinc-900 dark:text-zinc-100">
      <header className="px-6 pb-4 pt-5">
        <nav className="mx-auto flex max-w-6xl items-center gap-8">
          <Link to="/" className="flex shrink-0 items-baseline gap-2 text-xl font-bold tracking-tight">
            <span>
              <span className="text-accent">Save</span>boxd
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              beta
            </span>
          </Link>
          {/* Le nom du site (à gauche) renvoie déjà à l'accueil — pas de lien
              "Home" redondant */}
          {user && (
            <div className="hidden items-center gap-7 text-sm sm:flex">
              <NavLink to="/friends" className={navLink}>
                Friends
              </NavLink>
              <NavLink to="/steam" className={navLink}>
                Steam
              </NavLink>
            </div>
          )}
          <div className="ml-auto w-56 min-w-0 max-w-full">
            <SearchBar />
          </div>
          <div className="flex shrink-0 items-center gap-4 text-sm">
            {user ? (
              <Link to={`/u/${user.username}`} className="flex items-center gap-2 hover:opacity-70">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <span className="h-6 w-6 rounded-full bg-zinc-300 dark:bg-zinc-800" />
                )}
                {user.username}
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Log in
                </Link>
                <Link
                  to="/signup"
                  className="rounded-full border border-zinc-400/60 px-4 py-1.5 transition hover:border-accent hover:text-accent dark:border-zinc-600"
                >
                  Sign up
                </Link>
              </>
            )}

            {/* Gear dropdown: day/night toggle for everyone; settings + logout when signed in */}
            <div className="relative">
              <button
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
                    aria-label="Close menu"
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                    className="fixed inset-0 z-10 cursor-default"
                  />
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-lg border border-zinc-900/10 bg-white py-1 shadow-lg dark:border-zinc-100/10 dark:bg-zinc-900"
                  >
                    {user && (
                      <Link
                        to="/settings"
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                      >
                        <Icon>{gearIcon}</Icon> Settings
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                    >
                      <Icon>{mode === 'dark' ? sunIcon : moonIcon}</Icon>
                      {mode === 'dark' ? 'Mode jour' : 'Mode nuit'}
                    </button>
                    {user && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                      >
                        <Icon>{logoutIcon}</Icon> Log out
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>

      {/* Privacy Policy and ToS must be reachable from the footer (subject requirement) */}
      <footer className="border-t border-zinc-900/10 px-6 py-4 text-sm text-zinc-500 dark:border-zinc-100/10 dark:text-zinc-400">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span>ft_transcendence — 42</span>
          <div className="flex gap-4">
            <Link to="/privacy-policy" className="hover:opacity-70">
              Privacy Policy
            </Link>
            <Link to="/terms-of-service" className="hover:opacity-70">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
