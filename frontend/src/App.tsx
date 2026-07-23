import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import Catalog from './pages/Catalog';
import Company from './pages/Company';
import Feed from './pages/Feed';
import ForgotPassword from './pages/ForgotPassword';
import Friends from './pages/Friends';
import Game from './pages/Game';
import Home from './pages/Home';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import PrivacyPolicy from './pages/PrivacyPolicy';
import PublicProfile from './pages/PublicProfile';
import ResetPassword from './pages/ResetPassword';
import Settings from './pages/Settings';
import Signup from './pages/Signup';
import Library from './pages/Library';
import TermsOfService from './pages/TermsOfService';
import VerifyEmail from './pages/VerifyEmail';

// The account page moved from /profile to /settings; backend OAuth/Steam
// callbacks still redirect to /profile?welcome=1 or ?steam=…, so keep the old
// path working and forward its query string.
//
// Retour post-login OAuth : au clic sur un bouton 42/Google, la page d'origine
// est mémorisée dans sessionStorage. Ici, pour un compte EXISTANT (pas de
// ?welcome), on y renvoie au lieu des settings. Un nouveau compte (?welcome=1)
// garde l'écran de bienvenue pour choisir son pseudo.
function LegacyProfileRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  // ?welcome=1 = nouveau compte (onboarding) ; ?steam=… / ?link=… = retour de
  // liaison d'un compte (Steam, Discord…) : dans ces cas on reste sur les settings.
  const keepSettings = params.has('welcome') || params.has('steam') || params.has('link');
  // Lu une seule fois (initializer) → stable même sous le double-render
  // StrictMode ; le nettoyage se fait dans l'effet ci-dessous.
  const [dest] = useState(() =>
    keepSettings ? null : sessionStorage.getItem('postLoginRedirect'),
  );
  useEffect(() => {
    sessionStorage.removeItem('postLoginRedirect');
  }, []);
  if (dest) return <Navigate to={dest} replace />;
  return <Navigate to={`/settings${search}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/games" element={<Catalog />} />
            <Route path="/game/:id" element={<Game />} />
            <Route path="/company/:id" element={<Company />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/terms-of-service" element={<TermsOfService />} />
            <Route path="/u/:username" element={<PublicProfile />} />
            <Route path="/profile" element={<LegacyProfileRedirect />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/feed" element={<Feed />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/library" element={<Library />} />
              {/* Anciennes routes → page globale (rétro-compat liens/onglets) */}
              <Route path="/steam" element={<Navigate to="/library?platform=steam" replace />} />
              <Route path="/psn" element={<Navigate to="/library?platform=psn" replace />} />
            </Route>
            {/* Catch-all : toute URL inconnue garde la navbar et affiche la 404 */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}
