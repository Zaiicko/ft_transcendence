import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { MailerModule } from '../mailer/mailer.module';
import { FEEDBACK_TICKET_REOPENER } from './feedback-ticket.interface';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [MailerModule, ChatModule], // ChatModule: admin replies land as a DM
  controllers: [FeedbackController],
  // Aliased under FEEDBACK_TICKET_REOPENER too: ChatService (ModuleRef,
  // { strict: false }) resolves it that way to reopen a ticket on a user
  // reply, without a value import cycle back into feedback.service.ts.
  providers: [FeedbackService, { provide: FEEDBACK_TICKET_REOPENER, useExisting: FeedbackService }],
})
export class FeedbackModule {}
