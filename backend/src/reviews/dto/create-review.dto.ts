import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsInt()
  @Min(0)
  @Max(10)
  rating: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  text: string;
}
