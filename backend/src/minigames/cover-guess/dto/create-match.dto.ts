import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsIn, IsInt } from 'class-validator';
import { CoverGuessDifficulty, CoverGuessRoundMode } from '../cover-guess.types';

export class CreateCoverGuessMatchDto {
  @IsIn(['easy', 'normal', 'hard'])
  difficulty: CoverGuessDifficulty;

  @IsIn(['TURNS', 'RACE'])
  roundMode: CoverGuessRoundMode;

  // First to reach this many round wins takes the match.
  @IsIn([3, 5, 7, 10])
  targetScore: number;

  // TURNS: seconds a player gets to answer before it's auto-passed for them.
  // RACE: seconds between each automatic reveal step.
  @IsIn([10, 15, 30])
  answerTimeSec: number;

  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  inviteeUserIds: number[];
}
