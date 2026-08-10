import {
  BadRequestException,
  Controller,
  forwardRef,
  Get,
  Inject,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AchievementsService } from '../achievements/achievements.service';
import { FeedService } from '../feed/feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUserLite } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { SteamWebApiService } from './steam-web-api.service';

@UseGuards(JwtAuthGuard)
@Controller('steam')
export class SteamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly webApi: SteamWebApiService,
    private readonly feed: FeedService,
    @Inject(forwardRef(() => AchievementsService))
    private readonly achievements: AchievementsService,
  ) {}

  private async requireSteamId(userId: number): Promise<string> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (!user.steamId) {
      throw new BadRequestException('No Steam account linked — visit /api/auth/steam first');
    }
    return user.steamId;
  }

  // The user's Steam library, matched against our catalog through the
  // steamAppId mapping. The frontend lists these so the user can mark them
  // played / rate them (existing reviews & playedGame endpoints).
  // `?refresh=true` forces an achievement resync.
  @Get('library')
  async library(@CurrentUser() current: JwtPayload, @Query('refresh') refresh?: string) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    if (!user.steamId) {
      throw new BadRequestException('No Steam account linked — visit /api/auth/steam first');
    }
    const steamId = user.steamId;

    const owned = await this.webApi.getOwnedGames(steamId);
    if (owned === null) {
      return { private: true, totalOwned: 0, matched: [], unmatchedCount: 0, achievements: null };
    }

    const byAppId = new Map(owned.map((g) => [g.appid, g]));
    const games = await this.prisma.game.findMany({
      where: { steamAppId: { in: [...byAppId.keys()] } },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        gameType: true,
        steamAppId: true,
        igdbRating: true,
        steamScore: true,
        releaseDate: true,
        avgCompletionMinutes: true,
        // What the user already marked, so the frontend can show it
        playedBy: {
          where: { userId: current.sub },
          select: { status: true, playedAt: true },
        },
        // Whether the user already reviewed it (fills the review shortcut)
        reviews: {
          where: { userId: current.sub },
          select: { id: true },
          take: 1,
        },
      },
    });

    // Achievements are synced once then cached on the user: Steam has no batch
    // call, so it is one request per game, far too heavy to redo on every view.
    // A resync happens when the cache is missing or ?refresh=true.
    // perGame is { appId: [earned, total, lastUnlock] }, lastUnlock being the
    // unix seconds of the last achievement (0 if none) — the real 100% date.
    // Older cache entries are [earned, total] pairs, so the 3rd field falls
    // back to 0.
    const cached = user.steamAchievements as
      | { syncedAt: string; perGame: Record<string, [number, number, number]> }
      | null;
    let perGame: Record<string, [number, number, number]>;
    let syncedAt: string;
    if (cached?.perGame && refresh !== 'true') {
      perGame = cached.perGame;
      syncedAt = cached.syncedAt;
    } else {
      perGame = await this.syncAchievements(steamId, owned);
      syncedAt = new Date().toISOString();
      await this.prisma.user.update({
        where: { id: current.sub },
        data: { steamAchievements: { syncedAt, perGame } },
      });
    }

    const matched = games
      .map(({ playedBy, reviews, ...game }) => {
        const ach = game.steamAppId ? perGame[String(game.steamAppId)] : undefined;
        return {
          ...game,
          playtimeMinutes: byAppId.get(game.steamAppId!)?.playtime_forever ?? 0,
          playedStatus: playedBy[0]?.status ?? null,
          reviewed: reviews.length > 0,
          achievements: ach ? { unlocked: ach[0], total: ach[1] } : null,
        };
      })
      .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);

    // Global summary over ALL synced games, not just the catalog ones, so it
    // reflects the user's real Steam progress.
    const entries = Object.values(perGame);
    const summary = {
      unlocked: entries.reduce((n, [u]) => n + u, 0),
      total: entries.reduce((n, [, t]) => n + t, 0),
      games: entries.length,
      perfect: entries.filter(([u, t]) => t > 0 && u === t).length,
      syncedAt,
    };

    // Catalog games at 100% -> feed events and the "Completed" calendar. The
    // real 100% date is the last achievement unlocked (lastUnlock, unix s);
    // 0 leaves the insert default (now).
    const completed = matched
      .filter((m) => m.achievements && m.achievements.total > 0 && m.achievements.unlocked === m.achievements.total)
      .map((m) => {
        const lastUnlock = m.steamAppId ? (perGame[String(m.steamAppId)]?.[2] ?? 0) : 0;
        return {
          gameId: m.id,
          completedAt: lastUnlock > 0 ? new Date(lastUnlock * 1000) : undefined,
        };
      });
    await this.feed.syncCompletions(current.sub, 'steam', completed);

    // Fallback for games whose achievements we can't read at all (private
    // profile setting, or the game simply has none — Steam's API collapses
    // both into the same empty response, so we can't tell them apart): if
    // playtime already clears the IGDB "average time to beat", treat it as
    // done too. Kept on its own platform tag so it never counts as a
    // verified "100%" (green) — only as "Fait" (amber), same as a manual mark.
    const estimated = matched
      .filter((m) => !m.achievements && m.avgCompletionMinutes && m.playtimeMinutes >= m.avgCompletionMinutes)
      .map((m) => ({ gameId: m.id }));
    await this.feed.syncCompletions(current.sub, 'steam_estimated', estimated);

    void this.achievements.evaluate(current.sub, ['completions', 'perfect', 'genres']);

    return {
      private: false,
      totalOwned: owned.length,
      matched,
      unmatchedCount: owned.length - matched.length,
      achievements: summary,
    };
  }

  // Fetches achievements for EVERY played game (playtime > 0), most played
  // first, in bounded concurrent batches. The safety cap guards against a
  // pathological library; beyond it, only the most played are kept.
  private async syncAchievements(
    steamId: string,
    owned: { appid: number; playtime_forever: number }[],
  ): Promise<Record<string, [number, number, number]>> {
    const SAFETY_CAP = 1000;
    const CONCURRENCY = 10;
    const played = owned
      .filter((g) => g.playtime_forever > 0)
      .sort((a, b) => b.playtime_forever - a.playtime_forever)
      .slice(0, SAFETY_CAP);

    const perGame: Record<string, [number, number, number]> = {};
    for (let i = 0; i < played.length; i += CONCURRENCY) {
      const batch = played.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (g) => {
          const a = await this.webApi.getPlayerAchievements(steamId, g.appid);
          if (a) perGame[String(g.appid)] = [a.unlocked, a.total, a.lastUnlock];
        }),
      );
    }
    return perGame;
  }

  // Steam friends who already have a Saveboxd account and aren't already
  // friends (or pending) with the current user.
  @Get('friends/suggestions')
  async friendSuggestions(@CurrentUser() current: JwtPayload) {
    const steamId = await this.requireSteamId(current.sub);

    const friendIds = await this.webApi.getFriendIds(steamId);
    if (friendIds === null) return { private: true, suggestions: [] };
    if (friendIds.length === 0) return { private: false, suggestions: [] };

    const candidates = await this.prisma.user.findMany({
      where: { steamId: { in: friendIds }, id: { not: current.sub } },
    });
    if (candidates.length === 0) return { private: false, suggestions: [] };

    const existing = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: current.sub, addresseeId: { in: candidates.map((c) => c.id) } },
          { addresseeId: current.sub, requesterId: { in: candidates.map((c) => c.id) } },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    });
    const linked = new Set(existing.flatMap((f) => [f.requesterId, f.addresseeId]));

    return {
      private: false,
      suggestions: candidates.filter((c) => !linked.has(c.id)).map(toPublicUserLite),
    };
  }
}
