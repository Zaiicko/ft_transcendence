import { ArrayMaxSize, IsArray, IsInt } from 'class-validator';

// New ordering for a list: the gameIds in the wanted order. Each item's
// position becomes its index in this array.
export class ReorderListDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  gameIds: number[];
}
