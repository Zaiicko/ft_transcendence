import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Add a password to a provider account (Steam/42/Google — no currentPassword
// to give) or change an existing one (currentPassword then required).
export class SetPasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
