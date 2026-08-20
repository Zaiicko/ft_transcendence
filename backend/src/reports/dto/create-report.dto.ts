import { ReportReason, ReportTargetType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class CreateReportDto {
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @ValidateIf((o) => o.targetType === 'REVIEW')
  @IsInt()
  reviewId?: number;

  @ValidateIf((o) => o.targetType === 'COMMENT')
  @IsInt()
  commentId?: number;

  @IsEnum(ReportReason)
  reason: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
