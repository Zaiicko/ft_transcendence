import { IsString, Matches } from 'class-validator';

// Linking an Xbox account: the user declares their public gamertag (1-30 chars
// of letters, digits and spaces — modern gamertags allow spaces), which the
// backend resolves to a XUID with its OpenXBL service key. Mirrors LinkPsnDto.
export class LinkXboxDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9 ]{1,30}$/, {
    message: 'gamertag must be a valid Xbox gamertag (1-30 letters, digits or spaces)',
  })
  gamertag!: string;
}
