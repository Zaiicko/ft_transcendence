import { IsNumber, Max, Min } from 'class-validator';

// Avatar framing (zoom + offset), later encoded in avatarUrl as an
// #af=scale,x,y fragment. x/y are image translation percentages.
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
