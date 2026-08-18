import { IsInt, IsOptional } from 'class-validator';

export class GuessPanoramaGuessDto {
  @IsOptional()
  @IsInt()
  catalogId?: number;
}
