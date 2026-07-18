import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';

@Module({
  imports: [GamesModule], // for IgdbService (logo sync)
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
