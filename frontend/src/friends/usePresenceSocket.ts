import { useEffect } from 'react';
import { io } from 'socket.io-client';

interface PresenceHandlers {
  onOnline: (userId: number) => void;
  onOffline: (userId: number) => void;
}

// `handlers` is only read at connect time; both callbacks are expected to use
// functional setState updaters so they stay correct without re-subscribing.
export function usePresenceSocket(handlers: PresenceHandlers, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('friend:online', ({ userId }: { userId: number }) => handlers.onOnline(userId));
    socket.on('friend:offline', ({ userId }: { userId: number }) => handlers.onOffline(userId));

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
