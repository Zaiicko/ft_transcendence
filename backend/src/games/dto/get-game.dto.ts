import { IsIn, IsOptional } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '../../users/dto/update-profile.dto';

export class GetGameDto {
  // Requests the description machine-translated to this language, cached
  // after the first request — omit or 'en' to get the original text as-is.
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  lang?: string;
}
