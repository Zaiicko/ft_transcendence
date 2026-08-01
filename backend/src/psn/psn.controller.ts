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

// Forme du cache stocké dans User.psnLibrary.
interface PsnCache {
  syncedAt: string;
  titles: TrophyTitle[];
  summary: PsnTrophySummary | null;
}

// Normalise un titre pour le matching PSN↔catalogue : minuscules + on ne garde
// que lettres/chiffres (retire ™®©, espaces, ponctuation, éditions "™").
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

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

  // Rattache un compte PlayStation : on résout le PSN Online ID déclaré en
  // accountId via la session service, puis on stocke l'ID + l'accountId (aucun
  // jeton par utilisateur). Le profil doit être public pour être trouvé.
  @Post('link')
  async link(@CurrentUser() current: JwtPayload, @Body() dto: LinkPsnDto) {
    const account = await this.api.resolveOnlineId(dto.onlineId.trim());
    if (!account) {
      throw new NotFoundException('Aucun compte PlayStation public trouvé pour cet Online ID');
    }

    // Aucune vérification d'unicité : la liaison ne prouve pas la propriété (on
    // lit juste un profil public par Online ID), donc bloquer un accountId déjà
    // utilisé permettrait à quelqu'un de « réserver » le compte d'autrui.
    // Plusieurs profils peuvent pointer le même Online ID.
    await this.prisma.user.update({
      where: { id: current.sub },
      // psnLibrary vidé : le cache d'un éventuel compte précédent ne doit pas
      // rester après un changement d'Online ID.
      data: { psnAccountId: account.accountId, psnOnlineId: account.onlineId, psnLibrary: Prisma.DbNull },
    });

    // Succès « comptes liés »
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

  // Bibliothèque PSN : les jeux joués (titres à trophées) matchés à notre
  // catalogue par nom, avec la progression de trophées par jeu, + le résumé
  // global de trophées. Miroir de GET /steam/library.
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
        // Profil privé OU erreur passagère : on ne vide pas la page si on a déjà
        // un cache — on le ressert. Sinon seulement, on signale "privé".
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

    // Jeux du catalogue à 100 % : tous les trophées obtenus (progress 100) OU un
    // platine décroché (décision produit : le platine vaut 100 %). → feed +
    // calendrier « Terminé ». Date réelle = dernier trophée (lastUpdatedDateTime).
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

  // Amis PSN déjà inscrits sur Saveboxd et pas encore amis (ni en attente) avec
  // l'utilisateur courant. Miroir de GET /steam/friends/suggestions.
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

  // Associe les titres PSN aux jeux du catalogue par nom normalisé (SQL), puis
  // décore chaque jeu de sa progression de trophées et de l'état de l'utilisateur
  // (déjà "joué" / déjà noté). Un jeu multi-plateformes n'apparaît qu'une fois.
  private async matchTitles(userId: number, titles: TrophyTitle[]) {
    // nom normalisé -> meilleur titre PSN (progression la plus haute)
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

    // norm -> premier jeu catalogue trouvé
    const gameByNorm = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!gameByNorm.has(r.norm)) gameByNorm.set(r.norm, r);

    const matched = normNames
      .map((n) => ({ game: gameByNorm.get(n), title: byNorm.get(n)! }))
      .filter((m): m is { game: (typeof rows)[number]; title: TrophyTitle } => !!m.game);

    // État de l'utilisateur pour ces jeux (joué / noté), en 2 requêtes groupées
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
        // Date du dernier trophée obtenu (≈ date du 100 % / platine) → calendrier
        // « Terminé ». ISO string ou null.
        lastUpdatedDateTime: title.lastUpdatedDateTime ?? null,
        playedStatus: playedBy.get(game.id)?.status ?? null,
        reviewed: reviewedIds.has(game.id),
      }))
      // les plus avancés / récents d'abord
      .sort((a, b) => b.trophies.progress - a.trophies.progress);
  }
}
