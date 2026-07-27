import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { FeedController } from './feed.controller';
import { FeedGateway } from './feed.gateway';
import { FeedService } from './feed.service';

// N'importe qu'AuthModule (JwtService pour le handshake WS) et LeaderboardModule
// (détection des jalons de classement) : aucune dépendance vers Reviews/Games,
// donc ces modules peuvent importer Feed sans créer de cycle.
@Module({
  imports: [AuthModule, LeaderboardModule],
  controllers: [FeedController],
  providers: [FeedService, FeedGateway],
  exports: [FeedService, FeedGateway],
})
export class FeedModule {}
