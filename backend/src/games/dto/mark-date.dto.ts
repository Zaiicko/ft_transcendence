import { IsDateString, IsOptional } from 'class-validator';

// Optional body for the "played" / "completed" markers: the user's own date,
// for games finished before signing up. Absent means now.
export class MarkDateDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}
