import { forwardRef, Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { ListsController } from './lists.controller';
import { ListsService } from './lists.service';

@Module({
  imports: [forwardRef(() => AchievementsModule)],
  controllers: [ListsController],
  providers: [ListsService],
  exports: [ListsService],
})
export class ListsModule {}
