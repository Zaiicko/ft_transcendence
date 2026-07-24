import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  // Optionnel : le pseudo est choisi dans le wizard d'onboarding. S'il n'est pas
  // fourni, le backend en génère un unique à partir de l'e-mail (comme OAuth).
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(24)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers and underscores',
  })
  username?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}
