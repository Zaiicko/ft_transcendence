import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Layout from './components/Layout';
import ForgotPassword from './pages/ForgotPassword';
import Friends from './pages/Friends';
import Game from './pages/Game';
import Home from './pages/Home';
import Login from './pages/Login';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Profile from './pages/Profile';
import ResetPassword from './pages/ResetPassword';
import Signup from './pages/Signup';
import SteamLibrary from './pages/SteamLibrary';
import TermsOfService from './pages/TermsOfService';
import VerifyEmail from './pages/VerifyEmail';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/game/:id" element={<Game />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-service" element={<TermsOfService />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/profile" element={<Profile />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/steam" element={<SteamLibrary />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
