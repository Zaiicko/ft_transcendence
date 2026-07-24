import { IsString, Matches } from 'class-validator';

// Rattachement d'un compte Xbox : l'utilisateur déclare son gamertag public
// (1-30 caractères : lettres, chiffres, espaces — les gamertags modernes
// autorisent les espaces). Le backend le résout ensuite en XUID via sa clé
// service OpenXBL. Miroir de LinkPsnDto.
export class LinkXboxDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9 ]{1,30}$/, {
    message: 'gamertag must be a valid Xbox gamertag (1-30 letters, digits or spaces)',
  })
  gamertag!: string;
}
