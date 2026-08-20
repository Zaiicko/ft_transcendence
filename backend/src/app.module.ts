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
import { FeedbackModule } from './feedback/feedback.module';
import { FriendsModule } from './friends/friends.module';
import { GamesModule } from './games/games.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { ListsModule } from './lists/lists.module';
import { CoverGuessModule } from './minigames/cover-guess/cover-guess.module';
import { ScreenshotGuessModule } from './minigames/screenshot-guess/screenshot-guess.module';
import { PanoramaGuessModule } from './minigames/panorama-guess/panorama-guess.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OgModule } from './og/og.module';
import { PresenceModule } from './presence/presence.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PsnModule } from './psn/psn.module';
import { XboxModule } from './xbox/xbox.module';
import { SteamModule } from './steam/steam.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Cron scheduler: background refresh of 100% completions.
    ScheduleModule.forRoot(),
    // Baseline rate limit for every HTTP route (WebSocket traffic is
    // unaffected — gated separately by JWT on the socket handshake).
    // Sensitive auth routes tighten this further via @Throttle(...).
    // skipIf disables it under NODE_ENV=test: the e2e suites create more than
    // 5 accounts and would otherwise hit 429 on signup. No effect in prod.
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
    OgModule,
    CoverGuessModule,
    ScreenshotGuessModule,
    PanoramaGuessModule,
    ReportsModule,
    FeedbackModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
