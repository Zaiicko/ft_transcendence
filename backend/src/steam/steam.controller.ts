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
import { toPublicUser } from '../users/public-user';
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
  // `?refresh=true` force une resynchronisation des succès.
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

    // Succès : synchronisés une seule fois puis mis en cache sur l'utilisateur
    // (Steam n'a pas d'appel groupé, c'est 1 requête/jeu — trop lourd à refaire
    // à chaque affichage). On resynchronise si le cache est absent ou si
    // ?refresh=true.
    // perGame : { appId: [obtenus, total, lastUnlock] }. lastUnlock = unix s du
    // dernier succès (0 si aucun) → date réelle du 100 %. (Anciennes entrées en
    // cache sont des paires [obtenus, total] : le 3ᵉ champ retombe sur 0.)
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

    // Résumé global : sur TOUS les jeux synchronisés (pas seulement ceux du
    // catalogue), pour refléter la vraie progression Steam de l'utilisateur.
    const entries = Object.values(perGame);
    const summary = {
      unlocked: entries.reduce((n, [u]) => n + u, 0),
      total: entries.reduce((n, [, t]) => n + t, 0),
      games: entries.length,
      perfect: entries.filter(([u, t]) => t > 0 && u === t).length,
      syncedAt,
    };

    // Jeux du catalogue à 100 % (tous les succès obtenus) → événements de feed +
    // calendrier « Terminé ». Date réelle du 100 % = dernier succès débloqué
    // (lastUnlock, unix s) ; 0 → on laisse le défaut (now) côté insertion.
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
    void this.achievements.evaluate(current.sub, ['completions', 'perfect', 'genres']);

    return {
      private: false,
      totalOwned: owned.length,
      matched,
      unmatchedCount: owned.length - matched.length,
      achievements: summary,
    };
  }

  // Récupère les succès de TOUS les jeux joués (temps de jeu > 0), les plus
  // joués d'abord, par lots concurrents bornés. Plafond de sécurité pour éviter
  // un cas pathologique (bibliothèque énorme) — au-delà, on prend les plus joués.
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
      suggestions: candidates.filter((c) => !linked.has(c.id)).map(toPublicUser),
    };
  }
}
