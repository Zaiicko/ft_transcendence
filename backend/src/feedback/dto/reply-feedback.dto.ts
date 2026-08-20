import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReplyFeedbackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;
}
