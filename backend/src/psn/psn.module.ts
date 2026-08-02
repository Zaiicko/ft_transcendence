import { forwardRef, Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { AuthModule } from '../auth/auth.module';
import { FeedModule } from '../feed/feed.module';
import { UsersModule } from '../users/users.module';
import { PsnApiService } from './psn-api.service';
import { PsnController } from './psn.controller';

// PlayStation account features through the psn-api lib. Single service-session
// model (PSN_SERVICE_NPSSO): users declare their public PSN Online ID, the
// backend resolves it and reads their public games, trophies and friends.
// No per-user token.
@Module({
  imports: [AuthModule, UsersModule, FeedModule, forwardRef(() => AchievementsModule)],
  controllers: [PsnController],
  providers: [PsnApiService],
  exports: [PsnApiService],
})
export class PsnModule {}
