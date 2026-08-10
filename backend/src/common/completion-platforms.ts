// GameCompletion.platform values that represent a platform-VERIFIED 100%
// (real achievement/trophy data), as opposed to 'manual' (self-reported) or
// '<platform>_estimated' (playtime guess used when achievements are private
// or the game has none — see steam.controller.ts). Kept as an explicit
// allow-list rather than "!== 'manual'" so a new estimated-completion source
// can never accidentally count as a verified 100%.
export const VERIFIED_COMPLETION_PLATFORMS = ['steam', 'xbox', 'psn'] as const;
