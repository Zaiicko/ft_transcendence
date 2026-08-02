import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { FeedController } from './feed.controller';
import { FeedGateway } from './feed.gateway';
import { FeedService } from './feed.service';

// Imports only AuthModule (JwtService for the WS handshake) and
// LeaderboardModule (milestone detection). Nothing points at Reviews or Games,
// so those modules can import Feed without creating a cycle.
@Module({
  imports: [AuthModule, LeaderboardModule],
  controllers: [FeedController],
  providers: [FeedService, FeedGateway],
  exports: [FeedService, FeedGateway],
})
export class FeedModule {}
