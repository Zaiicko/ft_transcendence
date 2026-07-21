import { Module } from '@nestjs/common';
import { FeedModule } from '../feed/feed.module';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GamesSyncService } from './games-sync.service';
import { IgdbService } from './igdb/igdb.service';
import { SteamService } from './steam/steam.service';
import { SteamSyncService } from './steam/steam-sync.service';

@Module({
  imports: [FeedModule],
  controllers: [GamesController],
  providers: [
    GamesService,
    GamesSyncService,
    IgdbService,
    SteamService,
    SteamSyncService,
  ],
  // IgdbService exported for CompaniesModule's logo sync
  exports: [GamesService, GamesSyncService, SteamSyncService, IgdbService],
})
export class GamesModule {}
