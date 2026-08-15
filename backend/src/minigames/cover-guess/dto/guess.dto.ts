import { IsIn, IsInt, IsOptional } from 'class-validator';
import { CoverGuessRoundMode } from '../cover-guess.types';

// catalogId omitted entirely = a pass in TURNS mode (the player didn't
// recognise it at this blur step, still burns their turn like a wrong guess
// would) — or, in RACE mode, the client's own reveal-schedule tick (see
// CoverGuessService.guessLocal): only LOCAL play needs to say which mode
// it's in, since a real (non-null) guess only advances the blur in TURNS
// mode. Multiplayer matches always derive the mode from the match itself.
export class GuessCoverGuessDto {
  @IsOptional()
  @IsInt()
  catalogId?: number;

  @IsOptional()
  @IsIn(['TURNS', 'RACE'])
  mode?: CoverGuessRoundMode;
}
