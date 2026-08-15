import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ScreenshotGuessController } from './screenshot-guess.controller';
import { ScreenshotGuessGateway } from './screenshot-guess.gateway';
import { ScreenshotGuessService } from './screenshot-guess.service';

@Module({
  imports: [AuthModule],
  controllers: [ScreenshotGuessController],
  providers: [ScreenshotGuessService, ScreenshotGuessGateway],
})
export class ScreenshotGuessModule {}
