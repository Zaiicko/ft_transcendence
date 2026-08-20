import { Module } from '@nestjs/common';
import { AchievementsModule } from '../achievements/achievements.module';
import { FeedModule } from '../feed/feed.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TranslationModule } from '../translation/translation.module';
import { CommentsController } from './comments/comments.controller';
import { ReviewCommentsController } from './comments/review-comments.controller';
import { ReviewCommentsService } from './comments/review-comments.service';
import { CompanyReviewsController } from './company-reviews.controller';
import { GameReviewsController } from './game-reviews.controller';
import { ReviewsController } from './reviews.controller';
import { ReviewsGateway } from './reviews.gateway';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [NotificationsModule, FeedModule, TranslationModule, AchievementsModule], // notifs + feed + traduction + succès
  controllers: [
    GameReviewsController,
    CompanyReviewsController,
    ReviewsController,
    ReviewCommentsController,
    CommentsController,
  ],
  providers: [ReviewsGateway, ReviewsService, ReviewCommentsService],
  exports: [ReviewsService, ReviewCommentsService], // ReviewsService: game/company average rating. ReviewCommentsService: ReportsModule's admin-delete path.
})
export class ReviewsModule {}
