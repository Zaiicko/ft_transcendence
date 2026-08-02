import { MessageType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class SendMessageDto {
  @IsInt()
  @IsPositive()
  toUserId!: number;

  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  // Share references, depending on `type` — the service checks consistency
  @IsOptional()
  @IsInt()
  @IsPositive()
  gameId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  reviewId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  sharedUserId?: number;
}
