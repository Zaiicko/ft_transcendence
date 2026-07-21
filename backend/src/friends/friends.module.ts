import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { PresenceModule } from '../presence/presence.module';
import { SteamModule } from '../steam/steam.module';
import { UsersModule } from '../users/users.module';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';

@Module({
  imports: [PresenceModule, SteamModule, UsersModule, ChatModule],
  controllers: [FriendsController],
  providers: [FriendsService],
  exports: [FriendsService],
})
export class FriendsModule {}
