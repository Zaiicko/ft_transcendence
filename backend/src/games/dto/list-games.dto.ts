import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export enum GameSort {
  // Bayesian blend of our users' ratings and the IGDB rating (default)
  RATING = 'rating',
  // Most marked as "played" by our users
  MOST_PLAYED = 'most_played',
  // Release date, newest first
  RECENT = 'recent',
  // IGDB vote count — "most known" games
  POPULAR = 'popular',
}

// Sort direction: each button toggles between desc (the default — best rated,
// most played, newest, most popular) and asc.
export enum SortDir {
  DESC = 'desc',
  ASC = 'asc',
}

export class ListGamesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @IsOptional()
  @IsEnum(GameSort)
  sort = GameSort.RATING;

  @IsOptional()
  @IsEnum(SortDir)
  dir = SortDir.DESC;

  // All filters are combinable, matched case-insensitively by substring
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  genre?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  platform?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  company?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;
}
