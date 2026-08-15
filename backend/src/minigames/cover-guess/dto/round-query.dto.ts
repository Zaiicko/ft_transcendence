import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional } from 'class-validator';
import { CoverGuessDifficulty } from '../cover-guess.types';

export class RoundQueryDto {
  @IsIn(['easy', 'normal', 'hard'])
  difficulty: CoverGuessDifficulty;

  // Comma-separated game ids already seen this local session, so a new round
  // doesn't repeat a cover the player just guessed.
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
}
