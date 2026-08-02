import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { AppNotification } from '../lib/types';

// Real-time notifications (`notification:new`); subscribed once while `enabled`, always calls the latest handler.
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
