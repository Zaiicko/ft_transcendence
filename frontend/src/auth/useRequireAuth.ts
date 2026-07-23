import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

// Garde d'action pour les invités. Renvoie une fonction : si l'utilisateur est
// connecté → true (l'appelant exécute son action) ; sinon on l'envoie vers
// /login en mémorisant la position exacte (chemin + query + #ancre) dans
// `state.from`, que Login relit pour revenir ici une fois connecté. Même
// convention que ProtectedRoute, mais on garde aussi le hash pour retomber sur
// l'avis/commentaire précis (ex. /game/12#review-5).
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
