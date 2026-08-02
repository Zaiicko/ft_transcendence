import { Module } from '@nestjs/common';
import { FeedModule } from '../feed/feed.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

// Depends on FeedModule (FeedGateway pushes the feed card on unlock) and
// NotificationsModule (the personal notification). Both import AuthModule,
// which pulls in Friends/Users and then Lists/Steam/PSN — and those import
// AchievementsModule through forwardRef to break the cycle on the consumer
// side (see each module concerned).
@Module({
  imports: [FeedModule, NotificationsModule],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
