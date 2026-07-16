import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @MaxLength(2000)
  text: string;

  // Present = reply to another comment; absent = top-level comment on the review
  @IsOptional()
  @IsInt()
  parentId?: number;
}
