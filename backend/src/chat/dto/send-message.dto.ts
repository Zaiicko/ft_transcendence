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

  // Références de partage (selon `type`) — le service valide la cohérence
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
