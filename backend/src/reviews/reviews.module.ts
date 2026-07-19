import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CommentsController } from './comments/comments.controller';
import { ReviewCommentsController } from './comments/review-comments.controller';
import { ReviewCommentsService } from './comments/review-comments.service';
import { CompanyReviewsController } from './company-reviews.controller';
import { GameReviewsController } from './game-reviews.controller';
import { ReviewsController } from './reviews.controller';
import { ReviewsGateway } from './reviews.gateway';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [NotificationsModule], // notifie likes/commentaires/réponses
  controllers: [
    GameReviewsController,
    CompanyReviewsController,
    ReviewsController,
    ReviewCommentsController,
    CommentsController,
  ],
  providers: [ReviewsGateway, ReviewsService, ReviewCommentsService],
  exports: [ReviewsService], // for the future games module (average rating)
})
export class ReviewsModule {}
