import { IsBoolean, IsOptional } from 'class-validator';

// Every customisable type is optional (opt-out). Unknown keys are ignored by
// the service; the whitelist keeps only these fields.
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
