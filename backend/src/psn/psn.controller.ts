import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { TrophyTitle } from 'psn-api';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AchievementsService } from '../achievements/achievements.service';
import { FeedService } from '../feed/feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUserLite } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { LinkPsnDto } from './dto/link-psn.dto';
import { LinkPsnRelayDto, SubmitPsnRelayDto } from './dto/psn-relay.dto';
import { PsnApiService, PsnRelayResult, PsnTrophySummary } from './psn-api.service';

// Shape of the cache stored in User.psnLibrary. completedGameIds is our own
// record of what was 100%/platinum as of the last sync — the anomaly check
// below diffs against it rather than re-deriving it from raw PSN titles.
interface PsnCache {
  syncedAt: string;
  titles: TrophyTitle[];
  summary: PsnTrophySummary | null;
  completedGameIds?: number[];
}

// A resync (not the first one) that suddenly adds more newly-100% games than
// this in one go gets logged — plausible for a first sync (a whole existing
// library shows up at once) but suspicious afterwards. This can't PROVE
// tampering (nothing stops a determined user from editing the relayed JSON in
// devtools — see psn-api.service.ts's relay note), it's a deterrent/audit
// trail only, same trust level the manual "Fait" button already has.
const ANOMALY_THRESHOLD = 3;

const RELAY_THROTTLE = { default: { limit: 6, ttl: 60_000 } };

// Normalises a title for PSN/catalog matching: lowercase, letters and digits
// only (drops ™®©, spaces, punctuation, edition suffixes).
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

@UseGuards(JwtAuthGuard)
@Controller('psn')
export class PsnController {
  private readonly logger = new Logger(PsnController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly api: PsnApiService,
    private readonly feed: FeedService,
    @Inject(forwardRef(() => AchievementsService))
    private readonly achievements: AchievementsService,
  ) {}

  private async requireAccountId(userId: number): Promise<string> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (!user.psnAccountId) {
      throw new BadRequestException('Aucun compte PlayStation lié — lie-le d’abord dans les réglages');
    }
    return user.psnAccountId;
  }

  private result(results: PsnRelayResult[], id: string): PsnRelayResult {
    return results.find((r) => r.id === id) ?? { id, ok: false, body: null };
  }

  // Step 1 of linking: hands the browser the Sony search call + a short-lived
  // access token. See psn-api.service.ts's relay note for why this can't run
  // server-side.
  @Post('link/prepare')
  @Throttle(RELAY_THROTTLE)
  async prepareLink(@Body() dto: LinkPsnDto) {
    return this.api.searchRelay(dto.onlineId.trim());
  }

  // Step 2: the browser reports back what Sony's search answered. Resolves
  // the declared PSN Online ID to an accountId and stores both (no per-user
  // token, still). The profile must be public to be found.
  @Post('link')
  @Throttle(RELAY_THROTTLE)
  async link(@CurrentUser() current: JwtPayload, @Body() dto: LinkPsnRelayDto) {
    const account = this.api.parseSearchResult(this.result(dto.results, 'search'), dto.onlineId.trim());
    if (!account) {
      throw new NotFoundException('Aucun compte PlayStation public trouvé pour cet Online ID');
    }

    // No uniqueness check on purpose: linking proves nothing (we only read a
    // public profile), so rejecting an already-used accountId would let someone
    // "reserve" another person's account. Several profiles may share an ID.
    await this.prisma.user.update({
      where: { id: current.sub },
      // psnLibrary cleared: a previous account's cache must not survive an
      // Online ID change.
      data: { psnAccountId: account.accountId, psnOnlineId: account.onlineId, psnLibrary: Prisma.DbNull },
    });

    // "Linked accounts" achievements
    void this.achievements.evaluate(current.sub, ['linked']);
    return { onlineId: account.onlineId, avatarUrl: account.avatarUrl };
  }

  @Delete('link')
  @HttpCode(204)
  async unlink(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    await this.prisma.user.update({
      where: { id: current.sub },
      data: { psnAccountId: null, psnOnlineId: null, psnLibrary: Prisma.DbNull },
    });
  }

  // Cached view only — never fetches Sony live (see relay note). Empty/stale
  // until the frontend runs prepareLibrary -> Sony -> syncLibrary once.
  @Get('library')
  async library(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    if (!user.psnAccountId) {
      throw new BadRequestException('Aucun compte PlayStation lié — lie-le d’abord dans les réglages');
    }
    const cached = user.psnLibrary as PsnCache | null;
    if (!cached?.titles) {
      return { private: false, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: null, syncedAt: null };
    }
    const matched = await this.matchTitles(current.sub, cached.titles);
    return {
      private: false,
      totalPlayed: cached.titles.length,
      matched,
      unmatchedCount: cached.titles.length - matched.length,
      summary: cached.summary,
      syncedAt: cached.syncedAt,
    };
  }

  // Step 1 of a (re)sync: hands the browser the trophy titles + summary calls.
  @Post('library/prepare')
  @Throttle(RELAY_THROTTLE)
  async prepareLibrary(@CurrentUser() current: JwtPayload) {
    const accountId = await this.requireAccountId(current.sub);
    return this.api.libraryRelay(accountId);
  }

  // Step 2: the browser reports back Sony's trophy titles + summary. Mirrors
  // the previous (blocked) server-side GET /psn/library behaviour, plus the
  // anomaly check described above ANOMALY_THRESHOLD.
  @Post('library/sync')
  @Throttle(RELAY_THROTTLE)
  async syncLibrary(@CurrentUser() current: JwtPayload, @Body() dto: SubmitPsnRelayDto) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    if (!user.psnAccountId) {
      throw new BadRequestException('Aucun compte PlayStation lié — lie-le d’abord dans les réglages');
    }
    const cached = user.psnLibrary as PsnCache | null;

    const titles = this.api.parseTitles(this.result(dto.results, 'titles'));
    const summary = this.api.parseTrophySummary(this.result(dto.results, 'summary'));
    if (titles === null) {
      // Private profile OR the browser's relay failed: never blank the page
      // when a cache exists — serve it again. Only report "private" without one.
      if (!cached?.titles) {
        return { private: true, totalPlayed: 0, matched: [], unmatchedCount: 0, summary, syncedAt: null };
      }
      const matched = await this.matchTitles(current.sub, cached.titles);
      return {
        private: false,
        totalPlayed: cached.titles.length,
        matched,
        unmatchedCount: cached.titles.length - matched.length,
        summary: cached.summary,
        syncedAt: cached.syncedAt,
      };
    }

    const syncedAt = new Date().toISOString();
    const matched = await this.matchTitles(current.sub, titles);

    // Catalog games at 100%: every trophy earned, or a platinum unlocked — a
    // product call that platinum counts as 100%. Feeds the "Completed" calendar,
    // dated by the last trophy (lastUpdatedDateTime).
    const completed = matched
      .filter((m) => m.trophies.progress === 100 || (m.trophies.earned?.platinum ?? 0) >= 1)
      .map((m) => {
        const d = m.lastUpdatedDateTime ? new Date(m.lastUpdatedDateTime) : null;
        return { gameId: m.id, completedAt: d && !isNaN(d.getTime()) ? d : undefined };
      });
    const completedIds = completed.map((c) => c.gameId);

    // Anomaly check: skipped on the very first sync (the whole library
    // legitimately shows up at once then).
    if (cached?.titles) {
      const previouslyCompleted = new Set(cached.completedGameIds ?? []);
      const newlyCompleted = completedIds.filter((id) => !previouslyCompleted.has(id));
      if (newlyCompleted.length > ANOMALY_THRESHOLD) {
        this.logger.warn(
          `Sync PSN suspecte — user ${current.sub}: ${newlyCompleted.length} nouveaux jeux à 100% d'un coup (ids: ${newlyCompleted.join(',')})`,
        );
      }
    }

    await this.prisma.user.update({
      where: { id: current.sub },
      data: {
        psnLibrary: { syncedAt, titles, summary, completedGameIds: completedIds } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.feed.syncCompletions(current.sub, 'psn', completed);
    void this.achievements.evaluate(current.sub, ['completions', 'perfect', 'genres']);

    return {
      private: false,
      totalPlayed: titles.length,
      matched,
      unmatchedCount: titles.length - matched.length,
      summary,
      syncedAt,
    };
  }

  // PSN friends already on Saveboxd who aren't friends (or pending) with the
  // current user. Not relayed (see psn-api.service.ts): quietly returns
  // {private:true} wherever m.np.playstation.com is blocked.
  @Get('friends/suggestions')
  async friendSuggestions(@CurrentUser() current: JwtPayload) {
    const accountId = await this.requireAccountId(current.sub);

    const friendIds = await this.api.getFriendAccountIds(accountId);
    if (friendIds === null) return { private: true, suggestions: [] };
    if (friendIds.length === 0) return { private: false, suggestions: [] };

    const candidates = await this.prisma.user.findMany({
      where: { psnAccountId: { in: friendIds }, id: { not: current.sub } },
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

  // Matches PSN titles to catalog games by normalised name (in SQL), then
  // decorates each game with its trophy progress and the user's state (already
  // played / already reviewed). A multi-platform game appears once.
  private async matchTitles(userId: number, titles: TrophyTitle[]) {
    // normalised name -> best PSN title (highest progress)
    const byNorm = new Map<string, TrophyTitle>();
    for (const t of titles) {
      const n = normalize(t.trophyTitleName);
      if (!n) continue;
      const prev = byNorm.get(n);
      if (!prev || t.progress > prev.progress) byNorm.set(n, t);
    }
    const normNames = [...byNorm.keys()];
    if (normNames.length === 0) return [];

    const rows = await this.prisma.$queryRaw<
      { id: number; title: string; coverUrl: string | null; gameType: string; norm: string }[]
    >`
      SELECT id, title, "coverUrl", "gameType"::text AS "gameType",
             lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) AS norm
      FROM "Game"
      WHERE lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) = ANY(${normNames})
    `;

    // norm -> first matching catalog game
    const gameByNorm = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!gameByNorm.has(r.norm)) gameByNorm.set(r.norm, r);

    const matched = normNames
      .map((n) => ({ game: gameByNorm.get(n), title: byNorm.get(n)! }))
      .filter((m): m is { game: (typeof rows)[number]; title: TrophyTitle } => !!m.game);

    // User state for these games (played / reviewed), in 2 batched queries
    const gameIds = matched.map((m) => m.game.id);
    const [played, reviewed] = await Promise.all([
      this.prisma.playedGame.findMany({
        where: { userId, gameId: { in: gameIds } },
        select: { gameId: true, status: true, playedAt: true },
      }),
      this.prisma.review.findMany({
        where: { userId, gameId: { in: gameIds } },
        select: { gameId: true },
      }),
    ]);
    const playedBy = new Map(played.map((p) => [p.gameId, p]));
    const reviewedIds = new Set(reviewed.map((r) => r.gameId));

    return matched
      .map(({ game, title }) => ({
        id: game.id,
        title: game.title,
        coverUrl: game.coverUrl,
        gameType: game.gameType,
        platform: title.trophyTitlePlatform,
        trophies: {
          earned: title.earnedTrophies,
          defined: title.definedTrophies,
          progress: title.progress,
        },
        // Last trophy date, standing in for the 100%/platinum date in the
        // "Completed" calendar. ISO string or null.
        lastUpdatedDateTime: title.lastUpdatedDateTime ?? null,
        playedStatus: playedBy.get(game.id)?.status ?? null,
        reviewed: reviewedIds.has(game.id),
      }))
      // furthest along first
      .sort((a, b) => b.trophies.progress - a.trophies.progress);
  }
}
