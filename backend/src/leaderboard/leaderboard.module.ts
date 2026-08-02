import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

// Leaderboards (completions / played / reviews) by scope and window. Read-only
// over data already stored, so AuthModule (JwtAuthGuard) is the only import.
@Module({
  imports: [AuthModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
