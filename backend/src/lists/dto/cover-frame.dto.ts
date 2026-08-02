import { IsNumber, Max, Min } from 'class-validator';

// List cover framing (zoom + offset), later encoded in coverUrl as an
// #af=scale,x,y fragment. Mirrors AvatarFrameDto: x/y are image translation
// percentages.
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
