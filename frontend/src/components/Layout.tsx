import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { applyMode, storedMode, ThemeMode } from '../lib/theme';
import SearchBar from './SearchBar';

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
      <header className="border-b border-zinc-900/10 px-6 py-4 dark:border-zinc-100/10">
        <nav className="mx-auto flex max-w-6xl items-center gap-6">
          <Link to="/" className="shrink-0 text-xl font-bold tracking-tight">
            🎮 Saveboxd
          </Link>
          <div className="mx-auto w-full max-w-md">
            <SearchBar />
          </div>
          <div className="flex shrink-0 items-center gap-4 text-sm">
            {user ? (
              <>
                <Link to="/friends" className="hover:opacity-70">
                  Friends
                </Link>
                <Link to="/steam" className="hover:opacity-70">
                  Steam
                </Link>
                <Link to={`/u/${user.username}`} className="flex items-center gap-2 hover:opacity-70">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-zinc-300 dark:bg-zinc-800" />
                  )}
                  {user.username}
                </Link>
              </>
            ) : (
              <>
                <Link to="/login" className="hover:opacity-70">
                  Log in
                </Link>
                <Link to="/signup" className="hover:opacity-70">
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
                className="rounded-full px-1 hover:opacity-70"
              >
                ⚙️
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
                        ⚙️ Settings
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                    >
                      {mode === 'dark' ? '☀️ Mode jour' : '🌙 Mode nuit'}
                    </button>
                    {user && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900/5 dark:hover:bg-zinc-100/10"
                      >
                        🚪 Log out
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
