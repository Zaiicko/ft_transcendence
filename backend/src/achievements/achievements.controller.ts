import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { AchievementsService } from './achievements.service';

// A user's achievements, public: powers the profile's "Achievements" section.
@Controller('achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @Get('user/:userId')
  forUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.achievements.getForUser(userId);
  }
}
