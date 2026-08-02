import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Must match frontend/src/i18n/index.ts's SUPPORTED_LANGUAGES
export const SUPPORTED_LANGUAGES = [
  'en',
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'nl',
  'pl',
  'tr',
  'zh',
  'ja',
  'ko',
  'ru',
] as const;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(24)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers and underscores',
  })
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  bio?: string;

  // Persists the user's chosen UI language to their profile so it follows
  // them across devices once logged in (localStorage covers logged-out use).
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: string;
}
