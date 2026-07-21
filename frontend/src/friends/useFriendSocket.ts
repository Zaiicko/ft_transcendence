import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

// Écoute les changements d'amitié (demande / acceptation / refus / suppression)
// émis par le backend en `friend:update`, et déclenche un refetch. Utilisé par
// le profil public, la page Friends et le widget de chat. Latest-ref : abonné
// une fois tant que `enabled`, appelle toujours le handler le plus récent.
export function useFriendSocket(onUpdate: () => void, enabled: boolean): void {
  const ref = useRef(onUpdate);

  useEffect(() => {
    ref.current = onUpdate;
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('friend:update', () => ref.current());
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
