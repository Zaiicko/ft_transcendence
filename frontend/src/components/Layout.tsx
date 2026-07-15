import { Link, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <nav className="mx-auto flex max-w-6xl items-center justify-between">
          <Link to="/" className="text-xl font-bold tracking-tight">
            🎮 Saveboxd
          </Link>
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
