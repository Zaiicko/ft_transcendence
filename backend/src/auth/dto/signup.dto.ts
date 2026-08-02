import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  email!: string;

  // Optional: the username is chosen in the onboarding wizard. Without one the
  // backend derives a unique username from the email, as OAuth does.
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
