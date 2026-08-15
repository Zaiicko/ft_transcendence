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
