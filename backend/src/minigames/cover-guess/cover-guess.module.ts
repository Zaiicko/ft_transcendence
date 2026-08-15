import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { CoverGuessController } from './cover-guess.controller';
import { CoverGuessGateway } from './cover-guess.gateway';
import { CoverGuessService } from './cover-guess.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [CoverGuessController],
  providers: [CoverGuessService, CoverGuessGateway],
})
export class CoverGuessModule {}
