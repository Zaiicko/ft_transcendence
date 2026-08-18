import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsIn, IsInt } from 'class-validator';

export class CreatePanoramaGuessMatchDto {
  // First to reach this many round wins takes the match.
  @IsIn([3, 5, 7, 10])
  targetScore: number;

  // Seconds a round stays open before it ends unresolved — longer than
  // screenshot-guess's equivalent since a panorama takes time to look around.
  @IsIn([15, 20, 30, 45])
  answerTimeSec: number;

  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  inviteeUserIds: number[];
}
