import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

// Guest action guard: returns a fn that runs if logged in, else redirects to /login remembering the exact location (path + query + hash).
export function useRequireAuth() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  return () => {
    if (user) return true;
    const from = location.pathname + location.search + location.hash;
    navigate('/login', { state: { from } });
    return false;
  };
}
