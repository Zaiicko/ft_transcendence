import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LinkXboxDto } from './dto/link-xbox.dto';
import { XboxApiService, XboxTitle } from './xbox-api.service';

// Normalise un titre pour le matching Xbox↔catalogue : minuscules + on ne garde
// que lettres/chiffres (retire ™®©, espaces, ponctuation). Identique à PSN.
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Forme du cache stocké dans User.xboxLibrary.
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
  ) {}

  // Rattache un compte Xbox : on résout le gamertag déclaré en XUID via la clé
  // service, puis on stocke le XUID + le gamertag (aucun jeton par utilisateur).
  // Le profil doit être public pour être trouvé. Miroir de POST /psn/link.
  @Post('link')
  async link(@CurrentUser() current: JwtPayload, @Body() dto: LinkXboxDto) {
    const account = await this.api.resolveGamertag(dto.gamertag.trim());
    if (!account) {
      throw new NotFoundException('Aucun compte Xbox public trouvé pour ce gamertag');
    }

    const owner = await this.prisma.user.findUnique({ where: { xboxXuid: account.xuid } });
    if (owner && owner.id !== current.sub) {
      throw new ConflictException('Ce compte Xbox est déjà lié à un autre profil');
    }

    await this.prisma.user.update({
      where: { id: current.sub },
      // xboxLibrary vidé : le cache d'un éventuel compte précédent ne doit pas
      // rester après un changement de gamertag.
      data: { xboxXuid: account.xuid, xboxGamertag: account.gamertag, xboxLibrary: Prisma.DbNull },
    });

    return { gamertag: account.gamertag, avatarUrl: account.avatarUrl };
  }

  @Delete('link')
  @HttpCode(204)
  async unlink(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    await this.prisma.user.update({
      where: { id: current.sub },
      data: { xboxXuid: null, xboxGamertag: null, xboxLibrary: Prisma.DbNull },
    });
  }

  // Bibliothèque Xbox : les jeux joués (titres à succès) matchés à notre
  // catalogue par nom, avec la progression de succès/Gamerscore par jeu, + le
  // résumé global (Gamerscore total, nb de jeux, jeux complétés à 100 %).
  // Les titres sont mis en cache sur l'utilisateur (OpenXBL est lent) ; on ne
  // resynchronise que sur ?refresh=true. Miroir de GET /steam/library.
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
        // Profil privé OU erreur passagère : on ne vide pas la page si on a déjà
        // un cache — on le ressert. Sinon seulement, on signale "privé".
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
      // Gamerscore officiel du profil (fallback : somme des titres si absent).
      gamerscore: gamerscore ?? titles.reduce((acc, t) => acc + t.currentGamerscore, 0),
      games: titles.length,
      // jeux complétés à 100 % : tout le Gamerscore du jeu obtenu. (OpenXBL ne
      // remplit pas totalAchievements ici, on se base donc sur le Gamerscore.)
      perfect: titles.filter((t) => t.totalGamerscore > 0 && t.currentGamerscore === t.totalGamerscore).length,
    };
    const matched = await this.matchTitles(current.sub, titles);
    return {
      private: false,
      totalPlayed: titles.length,
      matched,
      unmatchedCount: titles.length - matched.length,
      summary,
      syncedAt,
    };
  }

  // Associe les titres Xbox aux jeux du catalogue par nom normalisé (SQL), puis
  // décore chaque jeu de sa progression de succès et de l'état de l'utilisateur
  // (déjà "joué" / déjà noté). Un jeu vu plusieurs fois n'apparaît qu'une fois.
  // Calqué sur PsnController.matchTitles.
  private async matchTitles(userId: number, titles: XboxTitle[]) {
    // nom normalisé -> meilleur titre Xbox (progression la plus haute)
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

    // norm -> premier jeu catalogue trouvé
    const gameByNorm = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!gameByNorm.has(r.norm)) gameByNorm.set(r.norm, r);

    const matched = normNames
      .map((n) => ({ game: gameByNorm.get(n), title: byNorm.get(n)! }))
      .filter((m): m is { game: (typeof rows)[number]; title: XboxTitle } => !!m.game);

    // État de l'utilisateur pour ces jeux (joué / noté), en 2 requêtes groupées
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
          // OpenXBL ne remplit pas totalAchievements sur cet endpoint : on
          // expose le nb de succès obtenus + le Gamerscore + le %.
          earned: title.currentAchievements,
          gamerscore: title.currentGamerscore,
          totalGamerscore: title.totalGamerscore,
          progress: title.progress,
        },
        lastPlayed: title.lastPlayed,
        playedStatus: playedBy.get(game.id)?.status ?? null,
        reviewed: reviewedIds.has(game.id),
      }))
      // les plus récemment joués d'abord (à défaut, les plus avancés)
      .sort((a, b) => {
        if (a.lastPlayed && b.lastPlayed) return a.lastPlayed < b.lastPlayed ? 1 : -1;
        if (a.lastPlayed) return -1;
        if (b.lastPlayed) return 1;
        return b.achievements.progress - a.achievements.progress;
      });
  }
}
