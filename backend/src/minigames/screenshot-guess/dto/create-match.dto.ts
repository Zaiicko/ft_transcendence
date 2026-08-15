import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsBoolean, IsIn, IsInt, Max, Min } from 'class-validator';
import { ScreenshotGuessDifficulty, ScreenshotGuessRoundMode } from '../screenshot-guess.types';

export class CreateScreenshotGuessMatchDto {
  @IsIn(['easy', 'normal', 'hard'])
  difficulty: ScreenshotGuessDifficulty;

  @IsIn(['TURNS', 'RACE'])
  roundMode: ScreenshotGuessRoundMode;

  // false = "no blur" mode: the screenshot is shown fully clear from the
  // start. Screenshots (unlike box-art covers) rarely show a title or logo,
  // so this is still genuinely hard even without any blur — the mode just
  // drops the blur-based reveal scaffolding for a fixed attempts budget
  // instead (see maxAttempts below), in both TURNS and RACE alike.
  @IsBoolean()
  blur: boolean;

  // Only meaningful when blur is false: total wrong-guess budget the round
  // gets before it's considered lost — one attempt per turn in TURNS, or
  // shared across everyone in RACE. Host-configurable rather than tied to
  // player count. Ignored when blur is true (still sent regardless, same as
  // answerTimeSec is sent even when RACE+no-blur ignores it).
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts: number;

  // First to reach this many round wins takes the match.
  @IsIn([3, 5, 7, 10])
  targetScore: number;

  // TURNS: seconds a player gets to answer before it's auto-passed for them
  // — always in effect, blur or not. RACE: seconds between each automatic
  // reveal step, only meaningful when blur is on (5s only makes sense here —
  // TURNS keeps 10/15/30 as its minimum, the client only offers 5 when
  // roundMode is RACE). RACE+no-blur has nothing to reveal on a schedule, so
  // this is ignored there — the round resolves via maxAttempts instead.
  @IsIn([5, 10, 15, 30])
  answerTimeSec: number;

  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Type(() => Number)
  inviteeUserIds: number[];
}
