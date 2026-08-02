import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GameType, PlayStatus, Prisma } from '@prisma/client';
import { AchievementsService } from '../achievements/achievements.service';
import { FeedService } from '../feed/feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../translation/translation.service';
import { GameSort, ListGamesDto, SortDir } from './dto/list-games.dto';
import { GamesSyncService } from './games-sync.service';

// Below this many local matches, a search also queries IGDB to enrich the
// catalog on the fly
const ON_DEMAND_THRESHOLD = 5;

// Recommendations — taste is built from BOTH the games a user reviewed and the
// games they played, so logging games actually shifts the suggestions:
//   • a review contributes (rating − NEUTRAL): a 9/10 pushes its genres hard, a
//     3/10 pushes them away (a genuine "not for me" signal), a 5/10 is neutral;
//   • a played game is a lighter positive nudge on its genres.
const RECOMMENDATION_NEUTRAL_RATING = 5;
const RECOMMENDATION_PLAYED_WEIGHT = 1.5;
// Recency: recent activity says more about current taste than an old log. Each
// signal is scaled from 1 (just now) down to a floor (long ago), halving around
// the half-life — so old games still count, they just weigh less.
const RECOMMENDATION_RECENCY_HALFLIFE_DAYS = 45;
const RECOMMENDATION_RECENCY_FLOOR = 0.5;
// How many genre-matching candidates we pull before re-ranking in JS — wide
// enough to not miss good matches, narrow enough to stay fast without a
// dedicated scoring query.
const RECOMMENDATION_CANDIDATE_POOL = 200;
// The final list is drawn from this many top matches by weighted-random pick:
// strong genre matches still dominate, but the exact line-up varies between
// loads instead of being frozen (same spirit as the shuffled "popular" row).
const RECOMMENDATION_SHORTLIST_FACTOR = 3;

// Bayesian confidence weight (IMDb-style): the external rating counts as this
// many virtual user votes, so a couple of accounts can't skew a game's score
// while a real crowd of users progressively takes over.
//   score = (n·avgUsers + W·external/10) / (n + W)
const RATING_CONFIDENCE_WEIGHT = 10;

// The external ratings get the same treatment BEFORE entering the blend:
// shrunk toward the catalog-wide average when they rest on few votes, so an
// obscure game rated 99 by 40 IGDB users can't outrank Super Metroid's 96
// backed by thousands. Each source is dampened by its own vote count.
const IGDB_VOTES_CONFIDENCE = 50;
const STEAM_REVIEWS_CONFIDENCE = 500;
// Games scored before steamRatingCount existed (or shared via an older
// catalog export) get a neutral assumed review count until the next sync.
const STEAM_COUNT_FALLBACK = 100;

const GAME_INCLUDE = {
  genres: true,
  platforms: true,
  companies: true,
} satisfies Prisma.GameInclude;

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: GamesSyncService,
    private readonly feed: FeedService,
    private readonly translation: TranslationService,
    private readonly achievements: AchievementsService,
  ) {}

  // Combinable filters (Prisma), then computed sorts (SQL aggregates: weighted
  // score, played count) on the filtered ids — same two-step pattern as the
  // reviews net-score sort.
  async list(dto: ListGamesDto) {
    const { page, limit } = dto;
    const where: Prisma.GameWhereInput = {
      // DLCs/expansions/mods never flood the catalog — they live on their
      // parent's page. Remakes/remasters/standalones stay listed even though
      // IGDB gives them a parent (e.g. The Last of Us Remastered).
      OR: [
        { parentId: null },
        { gameType: { in: [GameType.STANDALONE, GameType.REMAKE, GameType.REMASTER] } },
      ],
      ...(dto.q && { title: { contains: dto.q, mode: 'insensitive' as const } }),
      ...(dto.genre && {
        genres: { some: { name: { contains: dto.genre, mode: 'insensitive' as const } } },
      }),
      ...(dto.platform && {
        platforms: { some: { name: { contains: dto.platform, mode: 'insensitive' as const } } },
      }),
      ...(dto.company && {
        companies: { some: { name: { contains: dto.company, mode: 'insensitive' as const } } },
      }),
    };

    const candidates = await this.prisma.game.findMany({ where, select: { id: true } });
    const total = candidates.length;
    if (total === 0) return { data: [], total, page, limit };
    const ids = candidates.map((c) => c.id);

    // Direction driven by dto.dir (each button toggles desc/asc). Values come
    // from the SortDir enum, so Prisma.raw carries no injection risk.
    const dir = dto.dir === SortDir.ASC ? Prisma.raw('ASC') : Prisma.raw('DESC');
    const orderBy: Record<GameSort, Prisma.Sql> = {
      [GameSort.RATING]: Prisma.sql`score ${dir}, s."igdbRatingCount" DESC NULLS LAST`,
      [GameSort.MOST_PLAYED]: Prisma.sql`"playedCount" ${dir}, score DESC`,
      [GameSort.RECENT]: Prisma.sql`s."releaseDate" ${dir} NULLS LAST`,
      [GameSort.POPULAR]: Prisma.sql`s."igdbRatingCount" ${dir} NULLS LAST`,
    };

    type ScoredRow = {
      id: number;
      avgUserRating: number | null;
      userRatingCount: number;
      playedCount: number;
      score: number;
    };
    // Inner select: dampen each external rating toward the catalog-wide
    // average, weighted by its own vote count (igdb_d / steam_d, 0-100
    // scale). Outer select: blend the damped external note with our users'
    // ratings — same bayesian structure at both levels.
    const rows = await this.prisma.$queryRaw<ScoredRow[]>(Prisma.sql`
      SELECT s.id,
        s."avgUserRating",
        s."userRatingCount",
        s."playedCount",
        ((s."userRatingCount" * COALESCE(s."avgUserRating", 0)
          + ${RATING_CONFIDENCE_WEIGHT}
            * COALESCE((s.igdb_d + s.steam_d) / 2, s.igdb_d, s.steam_d, 50) / 10.0)
          / (s."userRatingCount" + ${RATING_CONFIDENCE_WEIGHT}))::float AS score
      FROM (
        SELECT g.id,
          r.avg            AS "avgUserRating",
          COALESCE(r.n, 0) AS "userRatingCount",
          COALESCE(p.n, 0) AS "playedCount",
          g."igdbRatingCount",
          g."releaseDate",
          CASE WHEN g."igdbRating" IS NOT NULL THEN
            (COALESCE(g."igdbRatingCount", 0) * g."igdbRating"
              + ${IGDB_VOTES_CONFIDENCE} * pr.igdb_avg)
            / (COALESCE(g."igdbRatingCount", 0) + ${IGDB_VOTES_CONFIDENCE})
          END AS igdb_d,
          CASE WHEN g."steamScore" IS NOT NULL THEN
            (COALESCE(g."steamRatingCount", ${STEAM_COUNT_FALLBACK}) * g."steamScore"
              + ${STEAM_REVIEWS_CONFIDENCE} * pr.steam_avg)
            / (COALESCE(g."steamRatingCount", ${STEAM_COUNT_FALLBACK}) + ${STEAM_REVIEWS_CONFIDENCE})
          END AS steam_d
        FROM "Game" g
        CROSS JOIN (
          SELECT AVG("igdbRating") AS igdb_avg, AVG("steamScore") AS steam_avg
          FROM "Game"
        ) pr
        LEFT JOIN (
          SELECT "gameId", AVG(rating)::float AS avg, COUNT(*)::int AS n
          FROM "Review" GROUP BY "gameId"
        ) r ON r."gameId" = g.id
        LEFT JOIN (
          SELECT "gameId", COUNT(*)::int AS n
          FROM "PlayedGame" WHERE status = 'PLAYED' GROUP BY "gameId"
        ) p ON p."gameId" = g.id
        WHERE g.id IN (${Prisma.join(ids)})
      ) s
      ORDER BY ${orderBy[dto.sort]}
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`);

    const games = await this.prisma.game.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: GAME_INCLUDE,
    });
    const byId = new Map(games.map((g) => [g.id, g]));
    const data = rows.map((row) => ({
      ...byId.get(row.id)!,
      avgUserRating: row.avgUserRating,
      userRatingCount: row.userRatingCount,
      playedCount: row.playedCount,
      score: Math.round(row.score * 100) / 100,
    }));
    return { data, total, page, limit };
  }

  // Filter options for the catalog: only genres/platforms/studios actually
  // attached to at least one game, most-used first. Genres/platforms are small
  // enumerable sets (rendered as chips/dropdowns); studios can be numerous, so
  // we cap them at the top ones by game count — the `company` substring filter
  // still matches anything typed.
  async facets() {
    const [genres, platforms, companies] = await Promise.all([
      this.prisma.genre.findMany({
        select: { id: true, name: true, _count: { select: { games: true } } },
        orderBy: { games: { _count: 'desc' } },
      }),
      this.prisma.platform.findMany({
        select: { id: true, name: true, _count: { select: { games: true } } },
        orderBy: { games: { _count: 'desc' } },
      }),
      this.prisma.company.findMany({
        select: { id: true, name: true, _count: { select: { games: true } } },
        orderBy: { games: { _count: 'desc' } },
        take: 60,
      }),
    ]);
    const clean = (rows: { id: number; name: string; _count: { games: number } }[]) =>
      rows
        .filter((r) => r._count.games > 0)
        .map((r) => ({ id: r.id, name: r.name, count: r._count.games }));
    return { genres: clean(genres), platforms: clean(platforms), companies: clean(companies) };
  }

  async findById(id: number, lang?: string) {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: {
        ...GAME_INCLUDE,
        // The game's page lists its rateable DLCs/expansions...
        dlcs: {
          where: {
            gameType: {
              in: [GameType.DLC, GameType.EXPANSION, GameType.STANDALONE],
            },
          },
          orderBy: { releaseDate: 'asc' },
          select: {
            id: true,
            title: true,
            coverUrl: true,
            releaseDate: true,
            gameType: true,
            igdbRating: true,
          },
        },
        // ...and a DLC's page links back to its base game
        parent: { select: { id: true, title: true, coverUrl: true } },
      },
    });
    if (!game) throw new NotFoundException(`Game ${id} not found`);
    if (lang && lang !== 'en' && game.summary) {
      game.summary = await this.getTranslatedSummary(id, game.summary, lang);
    }
    return game;
  }

  // On-demand translation cache (Solution D from the DB-bloat discussion):
  // only ever translates a (game, language) pair the first time it's
  // actually viewed, then reuses the stored result — never pre-translates
  // the whole catalog, and never fails the page load if translation is down.
  private async getTranslatedSummary(
    gameId: number,
    original: string,
    lang: string,
  ): Promise<string> {
    const cached = await this.prisma.gameTranslation.findUnique({
      where: { gameId_language: { gameId, language: lang } },
    });
    if (cached) return cached.description;
    try {
      const translated = await this.translation.translate(original, lang);
      await this.prisma.gameTranslation.upsert({
        where: { gameId_language: { gameId, language: lang } },
        create: { gameId, language: lang, description: translated },
        update: { description: translated },
      });
      return translated;
    } catch (err) {
      this.logger.warn(
        `Translation to "${lang}" failed for game ${gameId}: ${(err as Error).message}`,
      );
      return original;
    }
  }

  // "I played it" — the per-game heart count + the viewer's own mark (null
  // when anonymous or not marked). Backs the game page toggle button.
  async playedStatus(gameId: number, viewerId?: number) {
    const [count, completers, mine, completed] = await Promise.all([
      this.prisma.playedGame.count({
        where: { gameId, status: PlayStatus.PLAYED },
      }),
      // Distinct PLAYERS who completed this game (manual or platform 100%).
      // distinct userId, so finishing it on several platforms counts once.
      this.prisma.gameCompletion.findMany({
        where: { gameId },
        distinct: ['userId'],
        select: { userId: true },
      }),
      viewerId
        ? this.prisma.playedGame.findUnique({
            where: { userId_gameId: { userId: viewerId, gameId } },
            select: { status: true, playedAt: true },
          })
        : null,
      // Did the viewer mark this game completed by hand?
      viewerId
        ? this.prisma.gameCompletion.findUnique({
            where: { userId_gameId_platform: { userId: viewerId, gameId, platform: 'manual' } },
            select: { id: true },
          })
        : null,
    ]);
    return { count, completedCount: completers.length, mine, completedByMe: !!completed };
  }

  // Marks the game played. Optional `playedAt` is the user's own date (games
  // finished before signing up); defaults to now. Without a date, re-marking an
  // already-played game keeps the original one so a double click can't drift the
  // calendar. With a date, it is always applied — the user is correcting it.
  async markPlayed(userId: number, gameId: number, playedAt?: Date) {
    const exists = await this.prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`Game ${gameId} not found`);
    const current = await this.prisma.playedGame.findUnique({
      where: { userId_gameId: { userId, gameId } },
      select: { status: true },
    });
    const when = playedAt ?? new Date();
    const row = await this.prisma.playedGame.upsert({
      where: { userId_gameId: { userId, gameId } },
      update:
        playedAt || current?.status !== PlayStatus.PLAYED
          ? { status: PlayStatus.PLAYED, playedAt: when }
          : {},
      create: { userId, gameId, status: PlayStatus.PLAYED, playedAt: when },
    });
    // Fresh transition to played -> push to friends' feed (best-effort; the
    // service skips it when a review already exists)
    if (current?.status !== PlayStatus.PLAYED) void this.feed.onGamePlayed(userId, gameId);
    return { status: row.status, playedAt: row.playedAt };
  }

  // 204 even when nothing was marked (same idempotence rule as reactions)
  async unmarkPlayed(userId: number, gameId: number) {
    await this.prisma.playedGame.deleteMany({ where: { userId, gameId } });
  }

  // Manual "completed": creates a GameCompletion(platform='manual'), same
  // pipeline as platform 100% (green calendar + feed card). Completing implies
  // playing, so a PlayedGame PLAYED is guaranteed too.
  async markCompleted(userId: number, gameId: number, completedAt?: Date) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { id: true, releaseDate: true },
    });
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);
    // Guards on the user-picked date: not in the future, and not before the
    // game was released.
    if (completedAt) {
      if (completedAt.getTime() > Date.now() + 24 * 3600 * 1000) {
        throw new BadRequestException('Completion date cannot be in the future');
      }
      if (game.releaseDate && completedAt < game.releaseDate) {
        throw new BadRequestException('Completion date cannot be before the game was released');
      }
    }
    const current = await this.prisma.playedGame.findUnique({
      where: { userId_gameId: { userId, gameId } },
      select: { status: true },
    });
    const when = completedAt ?? new Date();
    // Completing implies playing: if not marked yet, set PLAYED on the same
    // date as the completion so both calendars agree.
    await this.prisma.playedGame.upsert({
      where: { userId_gameId: { userId, gameId } },
      update: current?.status === PlayStatus.PLAYED ? {} : { status: PlayStatus.PLAYED, playedAt: when },
      create: { userId, gameId, status: PlayStatus.PLAYED, playedAt: when },
    });
    const before = await this.prisma.gameCompletion.findUnique({
      where: { userId_gameId_platform: { userId, gameId, platform: 'manual' } },
      select: { id: true },
    });
    // When a date is given it is always reapplied — the user is correcting it.
    await this.prisma.gameCompletion.upsert({
      where: { userId_gameId_platform: { userId, gameId, platform: 'manual' } },
      update: completedAt ? { completedAt: when } : {},
      create: { userId, gameId, platform: 'manual', completedAt: when },
    });
    // New completion -> feed (plus "played" if it wasn't marked yet)
    if (!before) {
      if (current?.status !== PlayStatus.PLAYED) void this.feed.onGamePlayed(userId, gameId);
      void this.feed.onGameCompleted(userId, gameId);
    }
    // Achievements: a manual completion feeds the completions / genres families.
    void this.achievements.evaluate(userId, ['completions', 'genres']);
    return { completedByMe: true };
  }

  // Idempotent 204: only removes the MANUAL completion, never platform 100%
  async unmarkCompleted(userId: number, gameId: number) {
    await this.prisma.gameCompletion.deleteMany({ where: { userId, gameId, platform: 'manual' } });
  }

  // Local search always; the IGDB on-demand import only runs when the caller
  // explicitly asks for it (useIgdb) AND the local catalog has too few
  // matches. IGDB being down never breaks search — we log and return
  // whatever we have locally.
  async search(term: string, useIgdb = false) {
    let results = await this.searchLocal(term);
    if (useIgdb && results.length < ON_DEMAND_THRESHOLD) {
      try {
        const imported = await this.sync.importFromSearch(term);
        if (imported > 0) results = await this.searchLocal(term);
      } catch (err) {
        this.logger.warn(
          `On-demand IGDB import failed for "${term}": ${(err as Error).message}`,
        );
      }
    }
    return { data: results, total: results.length };
  }

  private searchLocal(term: string) {
    return this.prisma.game.findMany({
      where: { title: { contains: term, mode: 'insensitive' } },
      orderBy: [{ igdbRatingCount: { sort: 'desc', nulls: 'last' } }],
      take: 25,
      include: GAME_INCLUDE,
    });
  }

  // Content-based "recommended for you": builds a per-genre taste profile from
  // BOTH the games the user reviewed and the games they played, then ranks
  // unseen games by how well their genres match it.
  //   • a review weighs (rating − NEUTRAL): high ratings pull their genres in,
  //     low ratings push them away (a real "not for me"), decayed by age;
  //   • a played game is a lighter positive nudge, decayed the same way.
  // The final list is a weighted-random draw from the top matches, so strong
  // affinities dominate but the line-up isn't frozen between visits. Chosen over
  // collaborative filtering: on a small user base the per-user review overlap it
  // needs isn't there yet, while genre affinity is dense from day one.
  async recommendationsFor(userId: number, limit = 18) {
    const [reviews, played] = await Promise.all([
      this.prisma.review.findMany({
        where: { userId, gameId: { not: null } },
        select: {
          rating: true,
          createdAt: true,
          gameId: true,
          game: {
            select: {
              id: true,
              title: true,
              genres: { select: { id: true } },
              companies: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.playedGame.findMany({
        where: { userId },
        select: {
          status: true,
          playedAt: true,
          createdAt: true,
          gameId: true,
          game: {
            select: {
              id: true,
              title: true,
              genres: { select: { id: true } },
              companies: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    // Recent activity says more about current taste than an old log: 1 now,
    // decaying toward a floor and halving around the half-life.
    const recency = (date: Date) => {
      const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
      return (
        RECOMMENDATION_RECENCY_FLOOR +
        (1 - RECOMMENDATION_RECENCY_FLOOR) *
          Math.pow(0.5, ageDays / RECOMMENDATION_RECENCY_HALFLIFE_DAYS)
      );
    };

    const genreWeight = new Map<number, number>();
    const addGenres = (genres: { id: number }[], weight: number) => {
      if (weight === 0) return;
      for (const g of genres) genreWeight.set(g.id, (genreWeight.get(g.id) ?? 0) + weight);
    };
    // Taste profile per STUDIO, same logic as genres: backs the "because you
    // like games from <studio>" reason. The name is kept alongside.
    const studioWeight = new Map<number, number>();
    const studioName = new Map<number, string>();
    const addStudios = (companies: { id: number; name: string }[], weight: number) => {
      if (weight === 0) return;
      for (const c of companies) {
        studioWeight.set(c.id, (studioWeight.get(c.id) ?? 0) + weight);
        studioName.set(c.id, c.name);
      }
    };
    // Pool of "anchor games" so a recommendation can cite a concrete game
    // instead of a bare genre name. Two tiers: a well-rated game (rating above
    // neutral, tier 2, "because you liked X") outranks a merely played one
    // (tier 1). The pick happens per recommendation, by genre overlap, so the
    // anchor varies from card to card.
    type Anchor = { id: number; title: string; genres: Set<number>; tier: number; rating: number; at: number };
    const anchors: Anchor[] = [];
    for (const r of reviews) {
      const w = (r.rating - RECOMMENDATION_NEUTRAL_RATING) * recency(r.createdAt);
      addGenres(r.game?.genres ?? [], w);
      addStudios(r.game?.companies ?? [], w);
      if (!r.game || r.rating <= RECOMMENDATION_NEUTRAL_RATING) continue;
      anchors.push({
        id: r.game.id,
        title: r.game.title,
        genres: new Set(r.game.genres.map((g) => g.id)),
        tier: 2,
        rating: r.rating,
        at: r.createdAt.getTime(),
      });
    }
    for (const p of played) {
      if (p.status !== PlayStatus.PLAYED) continue;
      const w = RECOMMENDATION_PLAYED_WEIGHT * recency(p.playedAt ?? p.createdAt);
      addGenres(p.game?.genres ?? [], w);
      addStudios(p.game?.companies ?? [], w);
      if (!p.game) continue;
      anchors.push({
        id: p.game.id,
        title: p.game.title,
        genres: new Set(p.game.genres.map((g) => g.id)),
        tier: 1,
        rating: 0,
        at: (p.playedAt ?? p.createdAt).getTime(),
      });
    }

    // Only genres the user actually leans toward drive the candidate search;
    // disliked genres still subtract in the score below, but shouldn't pull in
    // candidates on their own.
    const likedGenreIds = [...genreWeight].filter(([, w]) => w > 0).map(([id]) => id);
    if (likedGenreIds.length === 0) return { data: [] };

    // Never recommend something the user has already reviewed or played.
    const exclude = [
      ...new Set([...played.map((p) => p.gameId), ...reviews.map((r) => r.gameId as number)]),
    ];

    const candidates = await this.prisma.game.findMany({
      where: {
        id: { notIn: exclude },
        genres: { some: { id: { in: likedGenreIds } } },
        // Same rule as the catalog list: DLCs/expansions surface on their
        // parent's page, never recommended standalone.
        OR: [
          { parentId: null },
          { gameType: { in: [GameType.STANDALONE, GameType.REMAKE, GameType.REMASTER] } },
        ],
      },
      include: GAME_INCLUDE,
      orderBy: [{ igdbRatingCount: { sort: 'desc', nulls: 'last' } }],
      take: RECOMMENDATION_CANDIDATE_POOL,
    });

    const scored = candidates
      .map((game) => ({
        game,
        score: game.genres.reduce((sum, g) => sum + (genreWeight.get(g.id) ?? 0), 0),
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score || (b.game.igdbRating ?? 0) - (a.game.igdbRating ?? 0));

    // Weighted-random draw from the strongest matches (probability ∝ score):
    // relevant, but a fresh line-up each visit instead of a frozen top.
    const shortlist = scored.slice(0, limit * RECOMMENDATION_SHORTLIST_FACTOR);
    const data = weightedSampleWithoutReplacement(
      shortlist.map((c) => ({ item: c.game, weight: c.score })),
      limit,
    );

    // Same bayesian score as the catalog list, so "Recommended" cards show the
    // rating pill like "Popular" ones do.
    const scores = await this.scoresByIds(data.map((g) => g.id));

    // Recommendation reason: the type varies from card to card (game / studio /
    // genre) so the row isn't justified the same way throughout. Options are
    // computed per game, then spread by always preferring the least-used type.

    // Best anchor game sharing the most genres with this one (tier first: a
    // liked game beats a merely played one).
    const anchorFor = (genreIds: number[], selfId: number): Anchor | null => {
      let best: Anchor | null = null;
      let bestOv = 0;
      for (const a of anchors) {
        if (a.id === selfId) continue;
        let ov = 0;
        for (const gid of genreIds) if (a.genres.has(gid)) ov += 1;
        if (ov === 0) continue;
        const better =
          !best ||
          a.tier > best.tier ||
          (a.tier === best.tier &&
            (ov > bestOv ||
              (ov === bestOv &&
                (a.rating > best.rating || (a.rating === best.rating && a.at > best.at)))));
        if (better) {
          best = a;
          bestOv = ov;
        }
      }
      return best;
    };
    // The game's studio carrying the most weight in the profile, or null.
    const studioFor = (companies: { id: number; name: string }[]) => {
      let best: { id: number; name: string } | null = null;
      let bestW = 0;
      for (const c of companies) {
        const w = studioWeight.get(c.id) ?? 0;
        if (w > bestW) {
          bestW = w;
          best = { id: c.id, name: studioName.get(c.id) ?? c.name };
        }
      }
      return best;
    };
    // The game's heaviest genre (candidates always have at least one above 0).
    const genreFor = (genres: { id: number; name: string }[]) => {
      let best: { id: number; name: string } | null = null;
      let bestW = -1;
      for (const g of genres) {
        const w = genreWeight.get(g.id) ?? 0;
        if (w > bestW) {
          bestW = w;
          best = { id: g.id, name: g.name };
        }
      }
      return best;
    };

    type Reason =
      | { kind: 'game'; game: { id: number; title: string; kind: 'liked' | 'played' } }
      | { kind: 'studio'; studio: { id: number; name: string } }
      | { kind: 'genre'; genre: { id: number; name: string } };
    type ReasonKind = Reason['kind'];

    const options = data.map((g) => ({
      anchor: anchorFor(g.genres.map((x) => x.id), g.id),
      studio: studioFor(g.companies),
      genre: genreFor(g.genres),
    }));

    // Spread: each card takes the least-used available type, ties broken by
    // richness (game > studio > genre).
    const RICHNESS: ReasonKind[] = ['game', 'studio', 'genre'];
    const usedCount: Record<ReasonKind, number> = { game: 0, studio: 0, genre: 0 };
    const reasons: (Reason | null)[] = options.map((o) => {
      const avail: ReasonKind[] = [];
      if (o.anchor) avail.push('game');
      if (o.studio) avail.push('studio');
      if (o.genre) avail.push('genre');
      if (avail.length === 0) return null;
      avail.sort((a, b) => usedCount[a] - usedCount[b] || RICHNESS.indexOf(a) - RICHNESS.indexOf(b));
      const kind = avail[0];
      usedCount[kind] += 1;
      if (kind === 'game' && o.anchor) {
        return {
          kind: 'game',
          game: {
            id: o.anchor.id,
            title: o.anchor.title,
            kind: o.anchor.tier === 2 ? ('liked' as const) : ('played' as const),
          },
        };
      }
      if (kind === 'studio' && o.studio) return { kind: 'studio', studio: o.studio };
      return { kind: 'genre', genre: o.genre! };
    });

    return {
      data: data.map((g, i) => ({ ...g, score: scores.get(g.id), reason: reasons[i] })),
    };
  }

  // Bayesian score (same formula as the catalog list) for a set of ids, as an
  // id -> score map. Used by recommendations, which pick their games outside
  // the catalog's scored query.
  private async scoresByIds(ids: number[]): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ id: number; score: number }[]>(Prisma.sql`
      SELECT s.id,
        ((s."userRatingCount" * COALESCE(s."avgUserRating", 0)
          + ${RATING_CONFIDENCE_WEIGHT}
            * COALESCE((s.igdb_d + s.steam_d) / 2, s.igdb_d, s.steam_d, 50) / 10.0)
          / (s."userRatingCount" + ${RATING_CONFIDENCE_WEIGHT}))::float AS score
      FROM (
        SELECT g.id,
          r.avg            AS "avgUserRating",
          COALESCE(r.n, 0) AS "userRatingCount",
          CASE WHEN g."igdbRating" IS NOT NULL THEN
            (COALESCE(g."igdbRatingCount", 0) * g."igdbRating"
              + ${IGDB_VOTES_CONFIDENCE} * pr.igdb_avg)
            / (COALESCE(g."igdbRatingCount", 0) + ${IGDB_VOTES_CONFIDENCE})
          END AS igdb_d,
          CASE WHEN g."steamScore" IS NOT NULL THEN
            (COALESCE(g."steamRatingCount", ${STEAM_COUNT_FALLBACK}) * g."steamScore"
              + ${STEAM_REVIEWS_CONFIDENCE} * pr.steam_avg)
            / (COALESCE(g."steamRatingCount", ${STEAM_COUNT_FALLBACK}) + ${STEAM_REVIEWS_CONFIDENCE})
          END AS steam_d
        FROM "Game" g
        CROSS JOIN (
          SELECT AVG("igdbRating") AS igdb_avg, AVG("steamScore") AS steam_avg
          FROM "Game"
        ) pr
        LEFT JOIN (
          SELECT "gameId", AVG(rating)::float AS avg, COUNT(*)::int AS n
          FROM "Review" GROUP BY "gameId"
        ) r ON r."gameId" = g.id
        WHERE g.id IN (${Prisma.join(ids)})
      ) s
    `);
    return new Map(rows.map((r) => [r.id, Math.round(r.score * 100) / 100]));
  }
}

// Draw up to `k` distinct items, each round picking one with probability
// proportional to its (positive) weight — a weighted shuffle of the top matches.
function weightedSampleWithoutReplacement<T>(items: { item: T; weight: number }[], k: number): T[] {
  const pool = items.filter((x) => x.weight > 0).map((x) => ({ ...x }));
  const out: T[] = [];
  while (out.length < k && pool.length > 0) {
    const total = pool.reduce((sum, x) => sum + x.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    while (idx < pool.length - 1 && (r -= pool[idx].weight) > 0) idx++;
    out.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return out;
}
