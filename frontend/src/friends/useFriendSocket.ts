import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

// Listens for friendship changes (`friend:update`) and triggers a refetch; latest-ref pattern.
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
