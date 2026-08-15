import { IsBoolean } from 'class-validator';

export class RespondScreenshotGuessDto {
  @IsBoolean()
  accept: boolean;
}
