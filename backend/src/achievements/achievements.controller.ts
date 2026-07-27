import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AchievementsService } from './achievements.service';

// Succès d'un utilisateur (public — pour la section « Succès » du profil).
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get('user/:userId')
  forUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.achievements.getForUser(userId);
  }
}
