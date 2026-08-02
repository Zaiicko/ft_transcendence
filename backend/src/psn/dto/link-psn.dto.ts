import { IsString, Matches } from 'class-validator';

// Linking a PlayStation account: the user declares their public PSN Online ID
// (3-16 chars: letters, digits, hyphen, underscore), which the backend then
// resolves to an accountId through its service session.
export class LinkPsnDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{3,16}$/, {
    message: 'onlineId must be a valid PSN Online ID (3-16 letters, digits, - or _)',
  })
  onlineId!: string;
}
