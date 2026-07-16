import { Module } from '@nestjs/common';
import { CommentsController } from './comments/comments.controller';
import { ReviewCommentsController } from './comments/review-comments.controller';
import { ReviewCommentsService } from './comments/review-comments.service';
import { GameReviewsController } from './game-reviews.controller';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [
    GameReviewsController,
    ReviewsController,
    ReviewCommentsController,
    CommentsController,
  ],
  providers: [ReviewsService, ReviewCommentsService],
  exports: [ReviewsService], // for the future games module (average rating)
})
export class ReviewsModule {}
