import { Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Layout from './components/Layout';
import Friends from './pages/Friends';
import Home from './pages/Home';
import Login from './pages/Login';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Profile from './pages/Profile';
import Signup from './pages/Signup';
import TermsOfService from './pages/TermsOfService';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-service" element={<TermsOfService />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/profile" element={<Profile />} />
            <Route path="/friends" element={<Friends />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
