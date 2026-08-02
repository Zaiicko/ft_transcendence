import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListCommentsDto extends PaginationDto {
  @IsOptional()
  @IsIn(['top', 'recent'])
  sort: 'top' | 'recent' = 'top';
}
