import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ScreenshotGuessDifficulty } from '../screenshot-guess.types';

export class RoundQueryDto {
  @IsIn(['easy', 'normal', 'hard'])
  difficulty: ScreenshotGuessDifficulty;

  // Comma-separated game ids already seen this local session, so a new round
  // doesn't repeat a screenshot the player just guessed.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Transform(({ value }) =>
    typeof value === 'string' && value.length
      ? value
          .split(',')
          .map(Number)
          .filter((n) => Number.isFinite(n))
      : [],
  )
  exclude: number[] = [];

  // false = "no blur" local round: shown fully clear from the start.
  @IsOptional()
  @Transform(({ value }) => value !== 'false')
  @IsBoolean()
  blur = true;

  // Only meaningful when blur is false and the local client is running
  // TURNS mode: how many total attempts (= player count) the round gets
  // before it's considered lost, since there's no blur budget to spend
  // instead. Unused by RACE (still unlimited attempts, only the timer ends
  // the round) and ignored when blur is true.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  attempts?: number;
}
