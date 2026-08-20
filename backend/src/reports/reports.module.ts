import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ReviewsModule], // ReviewsService/ReviewCommentsService for the admin-delete path
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
