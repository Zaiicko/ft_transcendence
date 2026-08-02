import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

// Real-time for game AND studio pages: one room per page, rejoined on mount and each reconnect.
export interface ReviewSocketHandlers {
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

export type ReviewTargetKind = 'game' | 'company';

// Latest-ref: subscribes once per (kind, id) but always calls the freshest handlers.
export function useReviewSocket(
  kind: ReviewTargetKind,
  id: number,
  handlers: ReviewSocketHandlers,
): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!Number.isFinite(id)) return;

    const socket = io({ path: '/socket.io', withCredentials: true });
    const join = () => socket.emit(`${kind}:join`, id);
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
  }, [kind, id]);
}
