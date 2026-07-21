import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';

@Module({
  imports: [AuthModule, PresenceModule], // JwtService (handshake WS) + statut en ligne
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService, ChatGateway], // ChatGateway : FriendsModule notifie l'acceptation
})
export class ChatModule {}
