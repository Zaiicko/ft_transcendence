import { ArrayMaxSize, IsIn, IsInt } from 'class-validator';
import { SUPPORTED_LANGUAGES } from '../../users/dto/update-profile.dto';

// Traduction en lot (auto-traduction de tous les avis affichés) : une seule
// requête, la traduction des manquants est séquentielle côté serveur.
export class TranslateReviewsDto {
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  ids: number[];

  @IsIn(SUPPORTED_LANGUAGES)
  lang: string;
}
