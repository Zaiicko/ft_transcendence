export type CoverGuessDifficulty = 'easy' | 'normal' | 'hard';

export type CoverGuessMatchStatus = 'LOBBY' | 'PLAYING' | 'FINISHED' | 'ABANDONED';

export interface CoverGuessPlayerState {
  userId: number;
  username: string;
  avatarUrl: string | null;
  score: number;
  status: 'PENDING' | 'ACCEPTED';
}

export interface CoverGuessRoundState {
  index: number;
  coverUrl: string;
  blurStepIndex: number;
  currentTurnUserId: number | null;
  resolved: boolean;
  answerGameId?: number;
  answerTitle?: string;
}

export interface CoverGuessMatchState {
  id: string;
  hostId: number;
  status: CoverGuessMatchStatus;
  difficulty: CoverGuessDifficulty;
  targetScore: number;
  players: CoverGuessPlayerState[];
  round: CoverGuessRoundState | null;
  winnerId?: number | null;
  participants?: { userId: number; username: string; score: number }[];
}
