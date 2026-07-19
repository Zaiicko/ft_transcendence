import { Matches } from 'class-validator';

export class TwoFactorCodeDto {
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code!: string;
}
