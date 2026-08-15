export type ScreenshotGuessDifficulty = 'easy' | 'normal' | 'hard';

// TURNS: each player gets one guess per blur step, in rotation, and a guess
// (right or wrong) is what advances the blur. RACE: the screenshot clears on
// its own on a fixed schedule regardless of who's guessing, everyone can
// attempt at any time, first correct guess wins the round.
export type ScreenshotGuessRoundMode = 'TURNS' | 'RACE';

// Number of reveal steps a round goes through (index 0 = heaviest blur, the
// last index = fully clear). Must match
// frontend/src/minigames/blurSteps.ts's BLUR_STEPS_PX.length exactly — the
// backend only ever tracks the index, the frontend maps it to a pixel value.
export const BLUR_STEP_COUNT = 7;
