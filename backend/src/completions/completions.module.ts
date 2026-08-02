import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { FeedModule } from '../feed/feed.module';
import { PsnModule } from '../psn/psn.module';
import { SteamModule } from '../steam/steam.module';
import { XboxModule } from '../xbox/xbox.module';
import { CompletionsService } from './completions.service';

// Cron-driven background refresh of 100% completions. Reuses each platform's
// exported API service plus FeedService (via FeedModule) to replay exactly the
// same detection as an interactive library sync. No controller — purely
// scheduled, see ScheduleModule in AppModule.
@Module({
  imports: [FeedModule, SteamModule, XboxModule, PsnModule, AchievementsModule],
  providers: [CompletionsService],
})
export class CompletionsModule {}
