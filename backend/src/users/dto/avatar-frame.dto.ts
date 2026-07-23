import { IsNumber, Max, Min } from 'class-validator';

// Cadrage de l'avatar (zoom + décalage), encodé ensuite dans avatarUrl via un
// fragment #af=scale,x,y. x/y sont des pourcentages de translation de l'image.
export class AvatarFrameDto {
  @IsNumber()
  @Min(1)
  @Max(4)
  scale: number;

  @IsNumber()
  @Min(-100)
  @Max(100)
  x: number;

  @IsNumber()
  @Min(-100)
  @Max(100)
  y: number;
}
