import { Module } from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GamesSyncService } from './games-sync.service';
import { IgdbService } from './igdb/igdb.service';
import { SteamService } from './steam/steam.service';
import { SteamSyncService } from './steam/steam-sync.service';

@Module({
  controllers: [GamesController],
  providers: [
    GamesService,
    GamesSyncService,
    IgdbService,
    SteamService,
    SteamSyncService,
  ],
  exports: [GamesService, GamesSyncService, SteamSyncService],
})
export class GamesModule {}
