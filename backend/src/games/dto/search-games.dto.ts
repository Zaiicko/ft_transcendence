import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SearchGamesDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  // false (default): local DB only — cheap, safe to call while typing.
  // true: also import matches from IGDB when the local catalog has too few
  // results — reserved for an explicit user action (Enter / search button).
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  igdb = false;
}
