import { IsNumber, Max, Min } from 'class-validator';

// Cadrage de la couverture de liste (zoom + décalage), encodé ensuite dans
// coverUrl via un fragment #af=scale,x,y. Miroir de AvatarFrameDto : x/y sont
// des pourcentages de translation de l'image.
export class CoverFrameDto {
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
