import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsIn, IsInt } from 'class-validator';
import { CoverGuessDifficulty } from '../cover-guess.types';

export class CreateCoverGuessMatchDto {
  @IsIn(['easy', 'normal', 'hard'])
  difficulty: CoverGuessDifficulty;

  // First to reach this many round wins takes the match.
  @IsIn([3, 5, 7, 10])
  targetScore: number;

  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  inviteeUserIds: number[];
}
