import { lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';

// Route-level code-splitting: each page is a separate lazy chunk; the loading fallback lives in Layout's <Suspense>.
const Catalog = lazy(() => import('./pages/Catalog'));
const Company = lazy(() => import('./pages/Company'));
const Feed = lazy(() => import('./pages/Feed'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Friends = lazy(() => import('./pages/Friends'));
const Game = lazy(() => import('./pages/Game'));
const Home = lazy(() => import('./pages/Home'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Login = lazy(() => import('./pages/Login'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const PublicProfile = lazy(() => import('./pages/PublicProfile'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Settings = lazy(() => import('./pages/Settings'));
const Signup = lazy(() => import('./pages/Signup'));
const Library = lazy(() => import('./pages/Library'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));

// /profile moved to /settings — keep the old path working (forward its query); an existing OAuth account (no ?welcome) returns to the remembered origin instead of settings.
function LegacyProfileRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  // ?welcome=1 = new OAuth account → full-screen onboarding wizard.
  const isWelcome = params.has('welcome');
  // ?steam=/?link= = account-linking return → stay on settings (or /welcome if onboarding unfinished).
  const keepSettings = isWelcome || params.has('steam') || params.has('link');
  const [dest] = useState(() =>
    keepSettings ? null : sessionStorage.getItem('postLoginRedirect'),
  );
  useEffect(() => {
    sessionStorage.removeItem('postLoginRedirect');
  }, []);
  if (dest) return <Navigate to={dest} replace />;
  if (isWelcome) return <Navigate to="/welcome" replace />;
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
              <Route path="/welcome" element={<Onboarding />} />
              <Route path="/feed" element={<Feed />} />
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/library" element={<Library />} />
              <Route path="/steam" element={<Navigate to="/library?platform=steam" replace />} />
              <Route path="/psn" element={<Navigate to="/library?platform=psn" replace />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}
