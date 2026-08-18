import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PanoramaGuessController } from './panorama-guess.controller';
import { PanoramaGuessGateway } from './panorama-guess.gateway';
import { PanoramaGuessService } from './panorama-guess.service';

@Module({
  imports: [AuthModule],
  controllers: [PanoramaGuessController],
  providers: [PanoramaGuessService, PanoramaGuessGateway],
})
export class PanoramaGuessModule {}
