import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Email or username — validateLocalLogin picks the lookup based on whether
  // it contains '@' (usernames never do, enforced at signup).
  @IsString()
  @MinLength(1)
  identifier!: string;

  @IsString()
  password!: string;
}
