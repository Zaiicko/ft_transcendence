import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <nav className="mx-auto flex max-w-6xl items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight">
            🎮 Saveboxd
          </Link>
          <div className="flex items-center gap-4 text-sm">
            {user ? (
              <>
                <Link to="/friends" className="hover:text-zinc-100">
                  Friends
                </Link>
                <Link to="/steam" className="hover:text-zinc-100">
                  Steam
                </Link>
                <Link to="/profile" className="flex items-center gap-2 hover:text-zinc-100">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-zinc-800" />
                  )}
                  {user.username}
                </Link>
                <button type="button" onClick={handleLogout} className="text-zinc-400 hover:text-zinc-100">
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="hover:text-zinc-100">
                  Log in
                </Link>
                <Link to="/signup" className="hover:text-zinc-100">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>

      {/* Privacy Policy and ToS must be reachable from the footer (subject requirement) */}
      <footer className="border-t border-zinc-800 px-6 py-4 text-sm text-zinc-400">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span>ft_transcendence — 42</span>
          <div className="flex gap-4">
            <Link to="/privacy-policy" className="hover:text-zinc-100">
              Privacy Policy
            </Link>
            <Link to="/terms-of-service" className="hover:text-zinc-100">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
