import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AchievementsService } from '../achievements/achievements.service';
import { FeedService } from '../feed/feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LinkXboxDto } from './dto/link-xbox.dto';
import { XboxApiService, XboxTitle } from './xbox-api.service';

// Normalises a title for Xbox/catalog matching: lowercase, letters and digits
// only (drops ™®©, spaces, punctuation). Same as PSN.
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Shape of the cache stored in User.xboxLibrary.
interface XboxCache {
  syncedAt: string;
  gamerscore: number | null;
  titles: XboxTitle[];
}

@UseGuards(JwtAuthGuard)
@Controller('xbox')
export class XboxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly api: XboxApiService,
    private readonly feed: FeedService,
    private readonly achievements: AchievementsService,
  ) {}

  // Links an Xbox account: resolves the declared gamertag to a XUID via the
  // service key, then stores XUID + gamertag (no per-user token). The profile
  // must be public to be found. Mirrors POST /psn/link.
  @Post('link')
  async link(@CurrentUser() current: JwtPayload, @Body() dto: LinkXboxDto) {
    const account = await this.api.resolveGamertag(dto.gamertag.trim());
    if (!account) {
      throw new NotFoundException('Aucun compte Xbox public trouvé pour ce gamertag');
    }

    // No uniqueness check on purpose: linking proves nothing (we only read a
    // public profile), so rejecting an already-used XUID would let someone
    // "reserve" another person's account. Several profiles may share a gamertag.
    await this.prisma.user.update({
      where: { id: current.sub },
      // xboxLibrary cleared: a previous account's cache must not survive a
      // gamertag change.
      data: { xboxXuid: account.xuid, xboxGamertag: account.gamertag, xboxLibrary: Prisma.DbNull },
    });

    // "Linked accounts" achievements
    void this.achievements.evaluate(current.sub, ['linked']);
    return { gamertag: account.gamertag, avatarUrl: account.avatarUrl };
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
        data: { xboxXuid: null, xboxGamertag: null, xboxLibrary: Prisma.DbNull },
      }),
      this.prisma.gameCompletion.deleteMany({ where: { userId: current.sub, platform: 'xbox' } }),
      this.prisma.playedGame.deleteMany({ where: { userId: current.sub, source: 'xbox' } }),
    ]);
  }

  // Xbox library: played titles matched to our catalog by name, with per-game
  // achievement/Gamerscore progress plus a global summary. Titles are cached on
  // the user (OpenXBL is slow) and only resynced on ?refresh=true. Mirrors
  // GET /steam/library.
  @Get('library')
  async library(@CurrentUser() current: JwtPayload, @Query('refresh') refresh?: string) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    if (!user.xboxXuid) {
      throw new BadRequestException('Aucun compte Xbox lié — lie-le d’abord dans les réglages');
    }

    const cached = user.xboxLibrary as XboxCache | null;
    let titles: XboxTitle[];
    let gamerscore: number | null;
    let syncedAt: string;
    if (cached?.titles && refresh !== 'true') {
      ({ titles, gamerscore, syncedAt } = cached);
    } else {
      const [fetched, officialGs] = await Promise.all([
        this.api.getTitles(user.xboxXuid),
        this.api.getGamerscore(user.xboxXuid),
      ]);
      if (fetched === null) {
        // Private profile OR transient error: never blank the page when a cache
        // exists — serve it again. Only report "private" without one.
        if (!cached?.titles) {
          return { private: true, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: null, syncedAt: null };
        }
        ({ titles, gamerscore, syncedAt } = cached);
      } else {
        titles = fetched;
        gamerscore = officialGs;
        syncedAt = new Date().toISOString();
        await this.prisma.user.update({
          where: { id: current.sub },
          data: { xboxLibrary: { syncedAt, gamerscore, titles } as unknown as Prisma.InputJsonValue },
        });
      }
    }

    const summary = {
      // Official profile Gamerscore, falling back to the sum of the titles.
      gamerscore: gamerscore ?? titles.reduce((acc, t) => acc + t.currentGamerscore, 0),
      games: titles.length,
      // 100% games: the whole Gamerscore earned. OpenXBL leaves
      // totalAchievements empty here, so Gamerscore is the only signal.
      perfect: titles.filter((t) => t.totalGamerscore > 0 && t.currentGamerscore === t.totalGamerscore).length,
    };
    const matched = await this.matchTitles(current.sub, titles);

    // Catalog games at 100% -> feed events and the "Completed" calendar. OpenXBL
    // gives no per-achievement date without a call per game, so lastPlayed
    // approximates the 100% date; 0/invalid falls back to now on insert.
    const completed = matched
      .filter((m) => m.achievements.totalGamerscore > 0 && m.achievements.gamerscore === m.achievements.totalGamerscore)
      .map((m) => {
        const d = m.lastPlayed ? new Date(m.lastPlayed) : null;
        return { gameId: m.id, completedAt: d && !isNaN(d.getTime()) ? d : undefined };
      });
    await this.feed.syncCompletions(current.sub, 'xbox', completed);
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

  // Read-only view of ANOTHER player's Xbox library, for the "view their
  // library" button on a public profile. Cache only — never triggers a live
  // OpenXBL fetch or the completions/achievements side effects, which stay
  // owner-only (via the interactive sync above or the background cron in
  // CompletionsService). `linked`/`synced` distinguish "no Xbox account" from
  // "linked but nothing cached yet"; `hidden` when the owner opted out
  // (libraryPublic) — bypassed when the viewer IS the owner. Mirrors
  // PsnController.publicLibrary.
  @Get('library/:username')
  async publicLibrary(@CurrentUser() current: JwtPayload, @Param('username') username: string) {
    const user = await this.users.findByUsername(username);
    if (!user) throw new NotFoundException();
    if (!user.xboxXuid) {
      return { linked: false, synced: false, hidden: false, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: null, syncedAt: null };
    }
    if (!user.libraryPublic && user.id !== current.sub) {
      return { linked: true, synced: false, hidden: true, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: null, syncedAt: null };
    }
    const cache = user.xboxLibrary as XboxCache | null;
    if (!cache?.titles) {
      return { linked: true, synced: false, hidden: false, totalPlayed: 0, matched: [], unmatchedCount: 0, summary: null, syncedAt: null };
    }

    const summary = {
      gamerscore: cache.gamerscore ?? cache.titles.reduce((acc, t) => acc + t.currentGamerscore, 0),
      games: cache.titles.length,
      perfect: cache.titles.filter((t) => t.totalGamerscore > 0 && t.currentGamerscore === t.totalGamerscore).length,
    };
    const matched = await this.matchTitles(user.id, cache.titles);
    return {
      linked: true,
      synced: true,
      hidden: false,
      totalPlayed: cache.titles.length,
      matched,
      unmatchedCount: cache.titles.length - matched.length,
      summary,
      syncedAt: cache.syncedAt,
    };
  }

  // Matches Xbox titles to catalog games by normalised name (in SQL), then
  // decorates each game with its achievement progress and the user's state
  // (already played / already reviewed). Duplicates collapse to one entry.
  // Modelled on PsnController.matchTitles.
  private async matchTitles(userId: number, titles: XboxTitle[]) {
    // normalised name -> best Xbox title (highest progress)
    const byNorm = new Map<string, XboxTitle>();
    for (const t of titles) {
      const n = normalize(t.name);
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
      .filter((m): m is { game: (typeof rows)[number]; title: XboxTitle } => !!m.game);

    // User state for these games (played / reviewed), in 2 batched queries
    const gameIds = matched.map((m) => m.game.id);
    const [played, reviewed] = await Promise.all([
      this.prisma.playedGame.findMany({
        where: { userId, gameId: { in: gameIds } },
        select: { gameId: true, status: true },
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
        achievements: {
          // OpenXBL leaves totalAchievements empty on this endpoint, so we
          // expose the earned count, the Gamerscore and the percentage.
          earned: title.currentAchievements,
          gamerscore: title.currentGamerscore,
          totalGamerscore: title.totalGamerscore,
          progress: title.progress,
        },
        lastPlayed: title.lastPlayed,
        playedStatus: playedBy.get(game.id)?.status ?? null,
        reviewed: reviewedIds.has(game.id),
      }))
      // most recently played first, then the furthest along
      .sort((a, b) => {
        if (a.lastPlayed && b.lastPlayed) return a.lastPlayed < b.lastPlayed ? 1 : -1;
        if (a.lastPlayed) return -1;
        if (b.lastPlayed) return 1;
        return b.achievements.progress - a.achievements.progress;
      });
  }
}
