import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { CoverGuessInvite } from './types';

// Real-time cover-guess invites (`coverguess:invite`) — a dedicated channel
// from the general notification system (see cover-guess.service.ts's
// createMatch): always live-only, never a bell entry.
export function useCoverGuessInviteSocket(onInvite: (invite: CoverGuessInvite) => void, enabled: boolean): void {
  const ref = useRef(onInvite);

  useEffect(() => {
    ref.current = onInvite;
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('coverguess:invite', (invite: CoverGuessInvite) => ref.current(invite));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
