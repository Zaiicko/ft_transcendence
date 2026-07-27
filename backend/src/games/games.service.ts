import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GameType, PlayStatus, Prisma } from '@prisma/client';
import { AchievementsService } from '../achievements/achievements.service';
import { FeedService } from '../feed/feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../translation/translation.service';
import { GameSort, ListGamesDto } from './dto/list-games.dto';
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

    const orderBy: Record<GameSort, Prisma.Sql> = {
      [GameSort.RATING]: Prisma.sql`score DESC, s."igdbRatingCount" DESC NULLS LAST`,
      [GameSort.MOST_PLAYED]: Prisma.sql`"playedCount" DESC, score DESC`,
      [GameSort.RECENT]: Prisma.sql`s."releaseDate" DESC NULLS LAST`,
      [GameSort.POPULAR]: Prisma.sql`s."igdbRatingCount" DESC NULLS LAST`,
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
      // Nb de JOUEURS distincts ayant terminé ce jeu (manuel ou 100 % plateforme).
      // distinct userId : un même joueur compté une fois même s'il l'a fini sur
      // plusieurs plateformes.
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
      // Le viewer a-t-il marqué ce jeu « terminé » à la main ?
      viewerId
        ? this.prisma.gameCompletion.findUnique({
            where: { userId_gameId_platform: { userId: viewerId, gameId, platform: 'manual' } },
            select: { id: true },
          })
        : null,
    ]);
    return { count, completedCount: completers.length, mine, completedByMe: !!completed };
  }

  // Marque le jeu « fait ». `playedAt` optionnel = date choisie par l'user
  // (jeux faits avant le compte / pas le jour même) ; défaut = maintenant.
  // Sans date fournie : re-marquer un jeu déjà « fait » garde sa date d'origine
  // (le calendrier ne doit pas dériver sur un double-clic). Avec une date
  // fournie : on la pose toujours (l'user corrige explicitement la date).
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
    // Nouvelle transition vers « fait » → pousse dans le feed des amis
    // (best-effort ; le service ignore le cas où un avis existe déjà)
    if (current?.status !== PlayStatus.PLAYED) void this.feed.onGamePlayed(userId, gameId);
    return { status: row.status, playedAt: row.playedAt };
  }

  // 204 even when nothing was marked (same idempotence rule as reactions)
  async unmarkPlayed(userId: number, gameId: number) {
    await this.prisma.playedGame.deleteMany({ where: { userId, gameId } });
  }

  // « Terminé » manuel : crée une GameCompletion(platform='manual') — même
  // pipeline que les 100 % plateformes (calendrier vert + feed « terminé »).
  // Terminer implique avoir joué → on garantit aussi un PlayedGame PLAYED.
  async markCompleted(userId: number, gameId: number, completedAt?: Date) {
    const exists = await this.prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
    if (!exists) throw new NotFoundException(`Game ${gameId} not found`);
    const current = await this.prisma.playedGame.findUnique({
      where: { userId_gameId: { userId, gameId } },
      select: { status: true },
    });
    const when = completedAt ?? new Date();
    // Terminer implique avoir joué : si pas encore « fait », on pose PLAYED à la
    // même date que la complétion (cohérence des deux calendriers).
    await this.prisma.playedGame.upsert({
      where: { userId_gameId: { userId, gameId } },
      update: current?.status === PlayStatus.PLAYED ? {} : { status: PlayStatus.PLAYED, playedAt: when },
      create: { userId, gameId, status: PlayStatus.PLAYED, playedAt: when },
    });
    const before = await this.prisma.gameCompletion.findUnique({
      where: { userId_gameId_platform: { userId, gameId, platform: 'manual' } },
      select: { id: true },
    });
    // Avec une date fournie : on la (re)pose toujours (l'user corrige la date).
    await this.prisma.gameCompletion.upsert({
      where: { userId_gameId_platform: { userId, gameId, platform: 'manual' } },
      update: completedAt ? { completedAt: when } : {},
      create: { userId, gameId, platform: 'manual', completedAt: when },
    });
    // Nouvelle complétion → feed (et « fait » si le jeu ne l'était pas encore)
    if (!before) {
      if (current?.status !== PlayStatus.PLAYED) void this.feed.onGamePlayed(userId, gameId);
      void this.feed.onGameCompleted(userId, gameId);
    }
    // Succès : « fait » manuel alimente les familles terminés / genres.
    void this.achievements.evaluate(userId, ['completions', 'genres']);
    return { completedByMe: true };
  }

  // 204 idempotent : ne retire que la complétion MANUELLE (pas les 100 % plateformes)
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
          game: { select: { genres: { select: { id: true } } } },
        },
      }),
      this.prisma.playedGame.findMany({
        where: { userId },
        select: {
          status: true,
          playedAt: true,
          createdAt: true,
          gameId: true,
          game: { select: { genres: { select: { id: true } } } },
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
    for (const r of reviews) {
      addGenres(r.game?.genres ?? [], (r.rating - RECOMMENDATION_NEUTRAL_RATING) * recency(r.createdAt));
    }
    for (const p of played) {
      if (p.status !== PlayStatus.PLAYED) continue;
      addGenres(p.game?.genres ?? [], RECOMMENDATION_PLAYED_WEIGHT * recency(p.playedAt ?? p.createdAt));
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

    return { data };
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
