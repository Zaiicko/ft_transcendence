import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { FeedItem } from '../lib/types';

// Reçoit l'activité des amis en temps réel (event `feed:new`). Latest-ref :
// abonné une fois tant que `enabled`, appelle toujours le handler le plus récent.
export function useFeedSocket(onNew: (item: FeedItem) => void, enabled: boolean): void {
  const ref = useRef(onNew);

  useEffect(() => {
    ref.current = onNew;
  });

  useEffect(() => {
    if (!enabled) return;
    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('feed:new', (item: FeedItem) => ref.current(item));
    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
