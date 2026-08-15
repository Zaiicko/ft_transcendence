import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { ScreenshotGuessMatchState } from './types';

// The backend joins every authenticated socket to its own "user:<id>" room on
// connect (see screenshot-guess.gateway.ts) — no explicit room-join event
// needed here, unlike useReviewSocket's per-page room.
export function useScreenshotGuessSocket(
  enabled: boolean,
  onState: (state: ScreenshotGuessMatchState) => void,
): void {
  const ref = useRef(onState);
  useEffect(() => {
    ref.current = onState;
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('screenshotguess:state', (state: ScreenshotGuessMatchState) => ref.current(state));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
