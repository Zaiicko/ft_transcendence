import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { FeedModule } from '../feed/feed.module';
import { PsnModule } from '../psn/psn.module';
import { SteamModule } from '../steam/steam.module';
import { XboxModule } from '../xbox/xbox.module';
import { CompletionsService } from './completions.service';

// Rafraîchissement de fond des complétions 100 % (cron). Réutilise les services
// API exportés par chaque plateforme + FeedService (via FeedModule) pour rejouer
// exactement la même détection que la synchro interactive de bibliothèque.
// Aucun contrôleur : purement planifié (cf. ScheduleModule dans AppModule).
@Module({
  imports: [FeedModule, SteamModule, XboxModule, PsnModule, AchievementsModule],
  providers: [CompletionsService],
})
export class CompletionsModule {}
