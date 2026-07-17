import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceGateway } from './presence.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [AuthModule], // for JwtService, to verify the socket handshake cookie
  providers: [PresenceService, PresenceGateway],
  exports: [PresenceService],
})
export class PresenceModule {}
