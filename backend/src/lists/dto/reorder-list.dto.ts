import { ArrayMaxSize, IsArray, IsInt } from 'class-validator';

// Nouvel ordre des jeux d'une liste : les gameId dans l'ordre voulu. La position
// de chaque item devient son index dans ce tableau.
export class ReorderListDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  gameIds: number[];
}
