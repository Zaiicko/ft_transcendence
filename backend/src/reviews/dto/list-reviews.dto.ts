import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ListReviewsDto extends PaginationDto {
  // popular = net score (likes - dislikes); discussed = most total comments
  @IsOptional()
  @IsIn(['popular', 'recent', 'discussed'])
  sort: 'popular' | 'recent' | 'discussed' = 'recent';
}
