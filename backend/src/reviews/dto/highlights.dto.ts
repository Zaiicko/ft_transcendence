import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class HighlightsDto extends PaginationDto {
  // Recency window: a home page shows what's alive, not the all-time top
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 30;
}
