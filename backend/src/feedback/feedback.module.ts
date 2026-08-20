import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { MailerModule } from '../mailer/mailer.module';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [MailerModule, ChatModule], // ChatModule: admin replies land as a DM
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
