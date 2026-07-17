import { Module } from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GamesSyncService } from './games-sync.service';
import { IgdbService } from './igdb/igdb.service';

@Module({
  controllers: [GamesController],
  providers: [GamesService, GamesSyncService, IgdbService],
  exports: [GamesService, GamesSyncService],
})
export class GamesModule {}
