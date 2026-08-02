import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Signup completion after a verified Steam OpenID sign-in. Steam gives us no
// email, so the user picks one; the username field is prefilled with their
// Steam persona name but freely editable. Password is optional — like the
// Google/42 accounts, a Steam account signs in through its provider and can
// set a password later via the reset-by-email flow.
export class SteamRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(24)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers and underscores',
  })
  username!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;
}
