import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  // Nouvel inscrit qui n'a pas terminé (ni explicitement passé) le wizard : on
  // le ramène sur /welcome tant que onboardedAt est nul — y compris au retour de
  // la liaison Steam (redirection pleine page). /welcome lui-même est exclu pour
  // ne pas boucler.
  if (!user.onboarded && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }
  return <Outlet />;
}
