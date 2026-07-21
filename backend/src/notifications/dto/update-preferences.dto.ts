import { IsBoolean, IsOptional } from 'class-validator';

// Chaque type personnalisable est optionnel (opt-out). Les clés inconnues sont
// ignorées par le service ; la whitelist ne garde que ces champs.
export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  FRIEND_REQUEST?: boolean;

  @IsOptional()
  @IsBoolean()
  FRIEND_ACCEPT?: boolean;

  @IsOptional()
  @IsBoolean()
  REVIEW_LIKE?: boolean;

  @IsOptional()
  @IsBoolean()
  REVIEW_COMMENT?: boolean;

  @IsOptional()
  @IsBoolean()
  COMMENT_REPLY?: boolean;

  @IsOptional()
  @IsBoolean()
  FRIEND_JOINED?: boolean;
}
