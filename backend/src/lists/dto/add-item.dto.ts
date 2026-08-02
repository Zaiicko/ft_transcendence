import { IsInt, IsPositive } from 'class-validator';

export class AddItemDto {
  @IsInt()
  @IsPositive()
  gameId!: number;
}
