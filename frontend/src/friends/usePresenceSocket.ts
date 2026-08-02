import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

interface PresenceHandlers {
  onOnline: (userId: number) => void;
  onOffline: (userId: number) => void;
}

// "Latest ref" pattern: the socket subscribes once (per `enabled` change) but
// always calls the freshest handlers — no re-subscription, no stale closure,
// and the effect's only real dependency is `enabled`.
export function usePresenceSocket(handlers: PresenceHandlers, enabled: boolean): void {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;

    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('friend:online', ({ userId }: { userId: number }) =>
      handlersRef.current.onOnline(userId),
    );
    socket.on('friend:offline', ({ userId }: { userId: number }) =>
      handlersRef.current.onOffline(userId),
    );

    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
