import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsBoolean, IsIn, IsInt } from 'class-validator';
import { ScreenshotGuessDifficulty, ScreenshotGuessRoundMode } from '../screenshot-guess.types';

export class CreateScreenshotGuessMatchDto {
  @IsIn(['easy', 'normal', 'hard'])
  difficulty: ScreenshotGuessDifficulty;

  @IsIn(['TURNS', 'RACE'])
  roundMode: ScreenshotGuessRoundMode;

  // false = "no blur" mode: the screenshot is shown fully clear from the
  // start. Screenshots (unlike box-art covers) rarely show a title or logo,
  // so this is still genuinely hard even without any blur — the mode just
  // drops the multi-attempt reveal scaffolding: in TURNS each player gets a
  // single attempt total for the round instead of one per blur step, and in
  // RACE the round just runs for one answerTimeSec window before ending.
  @IsBoolean()
  blur: boolean;

  // First to reach this many round wins takes the match.
  @IsIn([3, 5, 7, 10])
  targetScore: number;

  // TURNS: seconds a player gets to answer before it's auto-passed for them.
  // RACE: seconds between each automatic reveal step (5s only makes sense
  // here — TURNS keeps 10/15/30 as its minimum, the client only offers 5
  // when roundMode is RACE).
  @IsIn([5, 10, 15, 30])
  answerTimeSec: number;

  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  inviteeUserIds: number[];
}
