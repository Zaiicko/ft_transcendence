import { IsEmail, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

export class CreateFeedbackDto {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  message: string;

  // Only used for a guest submitter (a logged-in user's own email is used
  // instead) — lets us reply even though there's no account to look up.
  @IsOptional()
  @IsEmail()
  email?: string;

  // Current page, sent by the frontend for context — not trusted for
  // anything but display in the notification email.
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;
}
