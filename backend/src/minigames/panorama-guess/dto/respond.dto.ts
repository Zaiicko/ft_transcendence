import { IsBoolean } from 'class-validator';

export class RespondPanoramaGuessDto {
  @IsBoolean()
  accept: boolean;
}
