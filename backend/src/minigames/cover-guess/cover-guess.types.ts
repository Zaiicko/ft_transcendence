export type CoverGuessDifficulty = 'easy' | 'normal' | 'hard';

// Number of reveal steps a round goes through (index 0 = heaviest blur, the
// last index = fully clear). Must match
// frontend/src/minigames/blurSteps.ts's BLUR_STEPS_PX.length exactly — the
// backend only ever tracks the index, the frontend maps it to a pixel value.
export const BLUR_STEP_COUNT = 7;
