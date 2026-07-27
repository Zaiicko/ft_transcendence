import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AchievementsModule } from './achievements/achievements.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { CompaniesModule } from './companies/companies.module';
import { CompletionsModule } from './completions/completions.module';
import { FeedModule } from './feed/feed.module';
import { FriendsModule } from './friends/friends.module';
import { GamesModule } from './games/games.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
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
    // Planificateur (cron) : rafraîchissement de fond des complétions 100 %.
    ScheduleModule.forRoot(),
    // Baseline rate limit for every HTTP route (WebSocket traffic is
    // unaffected — gated separately by JWT on the socket handshake).
    // Sensitive auth routes tighten this further via @Throttle(...).
    // skipIf : désactivé sous NODE_ENV=test — les suites e2e (reviews/ranking)
    // créent >5 comptes et sinon se prennent des 429 sur signup. Zéro effet prod.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
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
    CompletionsModule,
    LeaderboardModule,
    AchievementsModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
