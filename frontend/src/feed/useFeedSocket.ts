import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { FeedItem } from '../lib/types';

// Real-time friend activity (`feed:new`); subscribed once while `enabled`, always calls the latest handler.
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
