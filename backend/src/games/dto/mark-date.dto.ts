import { IsDateString, IsOptional } from 'class-validator';

// Corps optionnel des marquages « fait » / « terminé » : la date choisie par
// l'user (jeux faits avant le compte / pas le jour même). Absente → maintenant.
export class MarkDateDto {
  @IsOptional()
  @IsDateString()
  date?: string;
}
