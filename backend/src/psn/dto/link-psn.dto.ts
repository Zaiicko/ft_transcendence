import { IsString, Matches } from 'class-validator';

// Rattachement d'un compte PlayStation : l'utilisateur déclare son PSN Online
// ID (pseudo public, 3-16 caractères : lettres, chiffres, tiret, underscore).
// Le backend le résout ensuite en accountId via sa session service.
export class LinkPsnDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{3,16}$/, {
    message: 'onlineId must be a valid PSN Online ID (3-16 letters, digits, - or _)',
  })
  onlineId!: string;
}
