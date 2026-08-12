import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { GamesModule } from '../games/games.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { UsersModule } from '../users/users.module';
import { OgController } from './og.controller';
import { OgRenderService } from './og-render.service';

@Module({
  imports: [GamesModule, CompaniesModule, ReviewsModule, UsersModule],
  controllers: [OgController],
  providers: [OgRenderService],
})
export class OgModule {}
