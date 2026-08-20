import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

// Nested inside ProtectedRoute in App.tsx, so `loading`/login are already
// handled there — this only adds the role check, redirecting a non-admin
// straight to home rather than showing a 403 page for a route nobody links to.
export default function AdminRoute() {
  const { user } = useAuth();
  if (!user || user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Outlet />;
}
