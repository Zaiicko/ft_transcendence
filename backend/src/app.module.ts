import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { CompaniesModule } from './companies/companies.module';
import { FeedModule } from './feed/feed.module';
import { FriendsModule } from './friends/friends.module';
import { GamesModule } from './games/games.module';
import { ListsModule } from './lists/lists.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PresenceModule } from './presence/presence.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PsnModule } from './psn/psn.module';
import { XboxModule } from './xbox/xbox.module';
import { SteamModule } from './steam/steam.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Baseline rate limit for every HTTP route (WebSocket traffic is
    // unaffected — gated separately by JWT on the socket handshake).
    // Sensitive auth routes tighten this further via @Throttle(...).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    GamesModule,
    CompaniesModule,
    ReviewsModule,
    ListsModule,
    ChatModule,
    FriendsModule,
    FeedModule,
    PresenceModule,
    NotificationsModule,
    SteamModule,
    PsnModule,
    XboxModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
