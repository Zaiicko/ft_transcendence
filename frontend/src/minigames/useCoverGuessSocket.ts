import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { CoverGuessMatchState } from './types';

// The backend joins every authenticated socket to its own "user:<id>" room on
// connect (see cover-guess.gateway.ts) — no explicit room-join event needed
// here, unlike useReviewSocket's per-page room.
export function useCoverGuessSocket(enabled: boolean, onState: (state: CoverGuessMatchState) => void): void {
  const ref = useRef(onState);
  useEffect(() => {
    ref.current = onState;
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('coverguess:state', (state: CoverGuessMatchState) => ref.current(state));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
