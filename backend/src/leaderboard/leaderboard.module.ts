import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

// Classements (complétions / jeux faits / avis) par portée et fenêtre. Lecture
// seule sur des données déjà en base : n'importe qu'AuthModule (JwtAuthGuard).
@Module({
  imports: [AuthModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
})
export class LeaderboardModule {}
