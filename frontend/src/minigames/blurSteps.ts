// Reveal steps for the cover-guess mini-game: index 0 is the starting heavy
// blur, the last index is fully clear. Length must match
// backend/src/minigames/cover-guess/cover-guess.types.ts's BLUR_STEP_COUNT —
// the backend only ever tracks the index, never a pixel value.
export const BLUR_STEPS_PX = [40, 28, 20, 14, 9, 5, 0];
