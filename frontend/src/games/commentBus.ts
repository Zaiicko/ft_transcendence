// Tiny event bus routing socket `comment:reaction` updates to the right CommentNode, unreachable by props.
export interface CommentReactionEvent {
  commentId: number;
  likes: number;
  dislikes: number;
}

const listeners = new Set<(e: CommentReactionEvent) => void>();

export function emitCommentReaction(e: CommentReactionEvent): void {
  listeners.forEach((l) => l(e));
}

export function onCommentReaction(cb: (e: CommentReactionEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
