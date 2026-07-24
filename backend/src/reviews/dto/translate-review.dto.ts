import { IsIn } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '../../users/dto/update-profile.dto';

export class TranslateReviewDto {
  @IsIn(SUPPORTED_LANGUAGES)
  lang: string;
}
