import { Module } from '@nestjs/common';
import { FeedModule } from '../feed/feed.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

// Dépend de FeedModule (FeedGateway pour pousser la carte de feed au déblocage)
// et NotificationsModule (notification perso). Ces deux modules importent
// AuthModule, qui importe Friends/Users → Lists/Steam/PSN. Ces derniers importent
// AchievementsModule via forwardRef pour casser le cycle de modules côté
// consommateur (voir chaque module concerné).
@Module({
  imports: [FeedModule, NotificationsModule],
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
