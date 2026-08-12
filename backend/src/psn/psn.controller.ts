import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
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
import { PsnApiService, PsnTrophySummary } from './psn-api.service';

// Shape of the cache stored in User.psnLibrary.
interface PsnCache {
  syncedAt: string;
  titles: TrophyTitle[];
  summary: PsnTrophySummary | null;
}

// Normalises a title for PSN/catalog matching: lowercase, letters and digits
// only (drops ™®©, spaces, punctuation).
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// PSN often lists a game's trophy list as its own "<Game> Trophies" (or
// "Trophy Set") entry rather than the base title — stripped BEFORE normalize
// so it still resolves to the catalog's base-game title instead of matching
// nothing (verified against real linked libraries: God of War, FIFA 23,
// Mortal Kombat 11, EA SPORTS FC 24-26, MultiVersus, Aragami all hit this).
const stripTrophySuffix = (s: string) => s.replace(/\s+troph(?:y|ies)(?:\s+set)?$/i, '');

@UseGuards(JwtAuthGuard)
@Controller('psn')
export class PsnController {
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

  // Links a PlayStation account: resolves the declared PSN Online ID to an
  // accountId through the service session, then stores both (no per-user
  // token). The profile must be public to be found.
  @Post('link')
  async link(@CurrentUser() current: JwtPayload, @Body() dto: LinkPsnDto) {
    const account = await this.api.resolveOnlineId(dto.onlineId.trim());
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
    // Also drops the 100%-completions and PLAYED marks this platform's sync
    // produced (never ones the user set by hand or another linked platform
    // confirmed — see PlayedGame.source).
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: current.sub },
        data: { psnAccountId: null, psnOnlineId: null, psnLibrary: Prisma.DbNull },
      }),
      this.prisma.gameCompletion.deleteMany({ where: { userId: current.sub, platform: 'psn' } }),
      this.prisma.playedGame.deleteMany({ where: { userId: current.sub, source: 'psn' } }),
    ]);
  }

  // PSN library: played trophy titles matched to our catalog by name, with
  // per-game trophy progress and the global trophy summary. Mirrors
  // GET /steam/library.
  @Get('library')
  async library(@CurrentUser() current: JwtPayload, @Query('refresh') refresh?: string) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    if (!user.psnAccountId) {
      throw new BadRequestException('Aucun compte PlayStation lié — lie-le d’abord dans les réglages');
    }
    const accountId = user.psnAccountId;

    const cached = user.psnLibrary as PsnCache | null;
    let titles: TrophyTitle[];
    let summary: PsnTrophySummary | null;
    let syncedAt: string;
    if (cached?.titles && refresh !== 'true') {
      ({ titles, summary, syncedAt } = cached);
    } else {
      const [fetched, fetchedSummary] = await Promise.all([
        this.api.getTitles(accountId),
        this.api.getTrophySummary(accountId),
      ]);
      if (fetched === null) {
        // Private profile OR transient error: never blank the page when a cache
        // exists — serve it again. Only report "private" without one.
        if (!cached?.titles) {
          return { private: true, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: fetchedSummary, syncedAt: null };
        }
        ({ titles, summary, syncedAt } = cached);
      } else {
        titles = fetched;
        summary = fetchedSummary;
        syncedAt = new Date().toISOString();
        await this.prisma.user.update({
          where: { id: current.sub },
          data: { psnLibrary: { syncedAt, titles, summary } as unknown as Prisma.InputJsonValue },
        });
      }
    }

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

  // Read-only view of ANOTHER player's PSN library, for the "view their
  // library" button on a public profile. Cache only — never triggers a live
  // Sony fetch or the completions/achievements side effects, which stay
  // owner-only (via the interactive sync above or the background cron in
  // CompletionsService). `linked`/`synced` distinguish "no PSN account" from
  // "linked but nothing cached yet"; `hidden` when the owner opted out
  // (libraryPublic) — bypassed when the viewer IS the owner, so previewing
  // your own page always works regardless of the setting.
  @Get('library/:username')
  async publicLibrary(@CurrentUser() current: JwtPayload, @Param('username') username: string) {
    const target = await this.users.findByUsername(username);
    if (!target) throw new NotFoundException();
    if (!target.psnAccountId) {
      return { linked: false, synced: false, hidden: false, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: null, syncedAt: null };
    }
    if (!target.libraryPublic && target.id !== current.sub) {
      return { linked: true, synced: false, hidden: true, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: null, syncedAt: null };
    }
    const cache = target.psnLibrary as PsnCache | null;
    if (!cache?.titles) {
      return { linked: true, synced: false, hidden: false, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: null, syncedAt: null };
    }

    const matched = await this.matchTitles(target.id, cache.titles);
    return {
      linked: true,
      synced: true,
      hidden: false,
      totalPlayed: cache.titles.length,
      matched,
      unmatchedCount: cache.titles.length - matched.length,
      summary: cache.summary,
      syncedAt: cache.syncedAt,
    };
  }

  // PSN friends already on Saveboxd who aren't friends (or pending) with the
  // current user. Mirrors GET /steam/friends/suggestions.
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
      const n = normalize(stripTrophySuffix(t.trophyTitleName));
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
