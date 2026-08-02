import { ArrayMaxSize, IsIn, IsInt } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '../../users/dto/update-profile.dto';

// Batch translation of every displayed review: one request, with the missing
// ones translated sequentially server-side.
export class TranslateReviewsDto {
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  ids: number[];

  @IsIn(SUPPORTED_LANGUAGES)
  lang: string;
}
