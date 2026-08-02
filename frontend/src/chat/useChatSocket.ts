import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { ChatMessage } from '../lib/types';

interface ChatHandlers {
  onMessage: (message: ChatMessage) => void;
  onRead: (by: number) => void;
}

// Chat socket, subscribed once while `enabled`, always calling the latest handlers (latest-ref).
export function useChatSocket(handlers: ChatHandlers, enabled: boolean): void {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;

    const socket = io({ path: '/socket.io', withCredentials: true });
    socket.on('chat:message', (message: ChatMessage) => handlersRef.current.onMessage(message));
    socket.on('chat:read', ({ by }: { by: number }) => handlersRef.current.onRead(by));

    return () => {
      socket.disconnect();
    };
  }, [enabled]);
}
