import { IsBoolean } from 'class-validator';

export class RespondCoverGuessDto {
  @IsBoolean()
  accept: boolean;
}
