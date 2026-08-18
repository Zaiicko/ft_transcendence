import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { PanoramaGuessMatchState } from './types';

// The backend joins every authenticated socket to its own "user:<id>" room on
// connect (see panorama-guess.gateway.ts) — no explicit room-join event
// needed here, unlike useReviewSocket's per-page room.
export function usePanoramaGuessSocket(
  enabled: boolean,
  onState: (state: PanoramaGuessMatchState) => void,
): void {
  const ref = useRef(onState);
  useEffect(() => {
    ref.current = onState;
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('panoramaguess:state', (state: PanoramaGuessMatchState) => ref.current(state));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
