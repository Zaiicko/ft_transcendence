import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

// Temps réel de la fiche jeu (docs/reviews-api.md §3). Une page = une room.
// On rejoint au montage ET à chaque `connect` (reconnexion auto). Les payloads
// de réaction portent les compteurs à jour → setState ciblés, aucun re-fetch.
export interface GameSocketHandlers {
  onReviewCreated: (review: unknown) => void;
  onReviewUpdated: (reviewId: number) => void;
  onReviewDeleted: (reviewId: number) => void;
  onReviewReaction: (p: { reviewId: number; likes: number; dislikes: number }) => void;
  onCommentChanged: (reviewId: number) => void;
  onCommentReaction: (p: {
    reviewId: number;
    commentId: number;
    likes: number;
    dislikes: number;
  }) => void;
}

// "Latest ref" : la socket s'abonne une fois par gameId, mais appelle toujours
// les handlers les plus frais — pas de ré-abonnement, pas de closure périmée.
export function useGameSocket(gameId: number, handlers: GameSocketHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!Number.isFinite(gameId)) return;

    const socket = io({ path: '/socket.io', withCredentials: true });
    const join = () => socket.emit('game:join', gameId);
    socket.on('connect', join); // couvre le 1er connect + les reconnexions

    socket.on('review:created', (r) => ref.current.onReviewCreated(r));
    socket.on('review:updated', ({ reviewId }: { reviewId: number }) =>
      ref.current.onReviewUpdated(reviewId),
    );
    socket.on('review:deleted', ({ reviewId }: { reviewId: number }) =>
      ref.current.onReviewDeleted(reviewId),
    );
    socket.on('review:reaction', (p: { reviewId: number; likes: number; dislikes: number }) =>
      ref.current.onReviewReaction(p),
    );
    socket.on('comment:changed', ({ reviewId }: { reviewId: number }) =>
      ref.current.onCommentChanged(reviewId),
    );
    socket.on(
      'comment:reaction',
      (p: { reviewId: number; commentId: number; likes: number; dislikes: number }) =>
        ref.current.onCommentReaction(p),
    );

    return () => {
      socket.disconnect();
    };
  }, [gameId]);
}
