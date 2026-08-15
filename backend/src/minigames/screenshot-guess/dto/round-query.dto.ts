import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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

  // Only meaningful when blur is false: how many total wrong-guess attempts
  // the round gets before it's considered lost, since there's no blur budget
  // to spend instead. Host-configurable at setup (not tied to player count).
  // Ignored when blur is true.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  attempts?: number;
}
