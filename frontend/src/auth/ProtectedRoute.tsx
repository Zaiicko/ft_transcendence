import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  // New signups who haven't finished onboarding are sent back to /welcome (itself excluded to avoid a loop).
  if (!user.onboarded && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }
  return <Outlet />;
}
