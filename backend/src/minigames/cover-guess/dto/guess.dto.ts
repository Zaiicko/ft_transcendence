import { IsInt, IsOptional } from 'class-validator';

// catalogId omitted entirely = a pass (the player didn't recognise it at this
// blur step, still burns their turn like a wrong guess would).
export class GuessCoverGuessDto {
  @IsOptional()
  @IsInt()
  catalogId?: number;
}
