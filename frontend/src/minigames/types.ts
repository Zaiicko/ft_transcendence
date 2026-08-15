export type MinigameSlug = 'cover-guess' | 'screenshot-guess';

export type CoverGuessDifficulty = 'easy' | 'normal' | 'hard';

// TURNS: everyone gets one guess per blur step, in rotation, and a guess
// (right or wrong) is what advances the blur. RACE: the cover clears on its
// own on a fixed schedule, anyone can attempt at any time, first correct
// guess wins the round.
export type CoverGuessRoundMode = 'TURNS' | 'RACE';

export type CoverGuessMatchStatus = 'LOBBY' | 'PLAYING' | 'FINISHED' | 'ABANDONED';

export interface CoverGuessPlayerState {
  userId: number;
  username: string;
  avatarUrl: string | null;
  score: number;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
}

export interface CoverGuessRoundState {
  index: number;
  coverUrl: string;
  blurStepIndex: number;
  currentTurnUserId: number | null;
  resolved: boolean;
  turnDeadline: number | null;
  answerGameId?: number;
  answerTitle?: string;
}

export interface CoverGuessMatchState {
  id: string;
  hostId: number;
  status: CoverGuessMatchStatus;
  difficulty: CoverGuessDifficulty;
  roundMode?: CoverGuessRoundMode;
  targetScore: number;
  answerTimeSec: number;
  players: CoverGuessPlayerState[];
  round: CoverGuessRoundState | null;
  winnerId?: number | null;
  participants?: { userId: number; username: string; score: number }[];
  history?: { gameId: number; title: string; coverUrl: string }[];
}

// ---- Screenshot-guess: same rules as cover-guess, a screenshot instead of
// the box-art cover. See CoverGuess* above for the type-by-type rationale.

export type ScreenshotGuessDifficulty = 'easy' | 'normal' | 'hard';
export type ScreenshotGuessRoundMode = 'TURNS' | 'RACE';
export type ScreenshotGuessMatchStatus = 'LOBBY' | 'PLAYING' | 'FINISHED' | 'ABANDONED';

export interface ScreenshotGuessPlayerState {
  userId: number;
  username: string;
  avatarUrl: string | null;
  score: number;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
}

export interface ScreenshotGuessRoundState {
  index: number;
  screenshotUrl: string;
  blurStepIndex: number;
  currentTurnUserId: number | null;
  resolved: boolean;
  turnDeadline: number | null;
  answerGameId?: number;
  answerTitle?: string;
}

export interface ScreenshotGuessMatchState {
  id: string;
  hostId: number;
  status: ScreenshotGuessMatchStatus;
  difficulty: ScreenshotGuessDifficulty;
  roundMode?: ScreenshotGuessRoundMode;
  // false = "no blur" mode — the screenshot is shown fully clear from the
  // start.
  blur?: boolean;
  targetScore: number;
  answerTimeSec: number;
  players: ScreenshotGuessPlayerState[];
  round: ScreenshotGuessRoundState | null;
  winnerId?: number | null;
  participants?: { userId: number; username: string; score: number }[];
  history?: { gameId: number; title: string; screenshotUrl: string }[];
}

// Pushed live via the `minigame:invite` socket event (shared by every
// mini-game) — a dedicated channel, not a persisted Notification:
// GameInviteOverlay is already a full-screen blocking prompt the moment
// this arrives, so there's nothing left for a bell entry to add.
export interface MinigameInvite {
  matchId: string;
  game: MinigameSlug;
  difficulty: CoverGuessDifficulty;
  actorId: number;
  actorUsername: string;
  actorAvatarUrl: string | null;
}
