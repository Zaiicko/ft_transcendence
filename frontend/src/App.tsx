import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Layout from './components/Layout';
import Catalog from './pages/Catalog';
import ForgotPassword from './pages/ForgotPassword';
import Friends from './pages/Friends';
import Game from './pages/Game';
import Home from './pages/Home';
import Login from './pages/Login';
import PrivacyPolicy from './pages/PrivacyPolicy';
import PublicProfile from './pages/PublicProfile';
import ResetPassword from './pages/ResetPassword';
import Settings from './pages/Settings';
import Signup from './pages/Signup';
import SteamLibrary from './pages/SteamLibrary';
import TermsOfService from './pages/TermsOfService';
import VerifyEmail from './pages/VerifyEmail';

// The account page moved from /profile to /settings; backend OAuth/Steam
// callbacks still redirect to /profile?welcome=1 or ?steam=…, so keep the old
// path working and forward its query string.
function LegacyProfileRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/settings${search}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/games" element={<Catalog />} />
          <Route path="/game/:id" element={<Game />} />
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
            <Route path="/settings" element={<Settings />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/steam" element={<SteamLibrary />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
