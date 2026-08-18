import { Transform } from 'class-transformer';
import { IsArray, IsInt, IsOptional } from 'class-validator';

export class RoundQueryDto {
  // Comma-separated PanoramaGuessEntry ids already seen this local session,
  // so a new round doesn't repeat a panorama the player just guessed.
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
