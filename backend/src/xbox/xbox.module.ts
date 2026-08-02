import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { AuthModule } from '../auth/auth.module';
import { FeedModule } from '../feed/feed.module';
import { UsersModule } from '../users/users.module';
import { XboxApiService } from './xbox-api.service';
import { XboxController } from './xbox.controller';

// Xbox account features through OpenXBL (xbl.io). Single service-key model
// (XBL_API_KEY): users declare their public gamertag, the backend resolves it
// and reads their public games and achievements. No per-user token.
// Mirrors PsnModule.
@Module({
  imports: [AuthModule, UsersModule, FeedModule, AchievementsModule],
  controllers: [XboxController],
  providers: [XboxApiService],
  exports: [XboxApiService],
})
export class XboxModule {}
