import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { MinigameInvite } from './types';

// Real-time mini-game invites (`minigame:invite`) — shared by every
// mini-game, a dedicated channel from the general notification system (see
// cover-guess.service.ts / screenshot-guess.service.ts's createMatch):
// always live-only, never a bell entry.
export function useMinigameInviteSocket(onInvite: (invite: MinigameInvite) => void, enabled: boolean): void {
  const ref = useRef(onInvite);

  useEffect(() => {
    ref.current = onInvite;
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('minigame:invite', (invite: MinigameInvite) => ref.current(invite));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
