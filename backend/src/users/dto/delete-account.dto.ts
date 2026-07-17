import { IsOptional, IsString } from 'class-validator';

export class DeleteAccountDto {
  // Required to confirm deletion of a LOCAL account; ignored for OAuth-only accounts
  @IsOptional()
  @IsString()
  password?: string;
}
