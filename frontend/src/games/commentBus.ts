// Petit bus d'évènements pour router `comment:reaction` (compteurs absolus) du
// socket (reçu dans Game.tsx) jusqu'au bon CommentNode, qui vit dans l'état
// local de ReviewComments — inatteignable par props sans tout remonter. Chaque
// CommentNode s'abonne à son id ; Game.tsx publie à la réception de l'évènement.
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
