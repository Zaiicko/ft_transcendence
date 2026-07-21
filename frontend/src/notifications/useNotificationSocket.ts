import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { AppNotification } from '../lib/types';

// Reçoit les notifications en temps réel (event `notification:new`). Latest-ref :
// abonné une fois tant que `enabled`, appelle toujours le handler le plus récent.
export function useNotificationSocket(onNew: (n: AppNotification) => void, enabled: boolean): void {
  const ref = useRef(onNew);

  useEffect(() => {
    ref.current = onNew;
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('notification:new', (n: AppNotification) => ref.current(n));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
