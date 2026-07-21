import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { CompaniesModule } from './companies/companies.module';
import { FriendsModule } from './friends/friends.module';
import { GamesModule } from './games/games.module';
import { ListsModule } from './lists/lists.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReviewsModule } from './reviews/reviews.module';
import { SteamModule } from './steam/steam.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    GamesModule,
    CompaniesModule,
    ReviewsModule,
    ListsModule,
    ChatModule,
    FriendsModule,
    PresenceModule,
    NotificationsModule,
    SteamModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
