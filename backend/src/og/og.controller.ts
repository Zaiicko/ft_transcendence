import { Controller, Get, Logger, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CompaniesService } from '../companies/companies.service';
import { GameSort, ListGamesDto, SortDir } from '../games/dto/list-games.dto';
import { GamesService } from '../games/games.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from '../reviews/reviews.service';
import { UsersService } from '../users/users.service';
import { catalogCard, companyCard, fallbackCard, gameCard, hubCard, profileCard, reviewCard } from './og-cards';
import { metaHtml } from './og-meta';
import { OgRenderService, SatoriNode } from './og-render.service';

// Server-rendered meta tags + PNG cards, for crawlers only (Discord, X,
// Slack, iMessage, ...). Nginx routes bot user-agents on /game/:id, /company/:id
// and /u/:username here instead of the SPA — real browsers never see this
// controller. Because those crawlers never execute JS, the SPA's client-side
// <title>/meta (which doesn't exist anyway) could never reach them.
@Controller('og')
export class OgController {
  private readonly logger = new Logger(OgController.name);

  constructor(
    private readonly games: GamesService,
    private readonly companies: CompaniesService,
    private readonly reviews: ReviewsService,
    private readonly users: UsersService,
    private readonly render: OgRenderService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // Top N games by IGDB notoriety — used as decorative cover art on cards
  // that have no single subject (homepage, catalog).
  private popularCovers(limit: number): Promise<string[]> {
    return this.games
      .list({ page: 1, limit, sort: GameSort.POPULAR, dir: SortDir.DESC } as ListGamesDto)
      .then((r) => r.data.map((g) => g.coverUrl).filter((c): c is string => !!c));
  }

  private siteUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') ?? 'https://localhost:8443').replace(/\/$/, '');
  }

  // The image sub-resource is fetched directly by the crawler from the
  // og:image URL — that request always hits nginx's plain /api passthrough,
  // no user-agent sniffing needed there.
  private imageUrl(path: string): string {
    return `${this.siteUrl()}/api/og/image/${path}`;
  }

  // Self-hosted avatars are stored/returned as a path relative to our own
  // origin (e.g. "/api/uploads/avatars/...") — fine for an <img> in the SPA,
  // but satori requires an absolute URL to fetch it. OAuth-provider avatars
  // (Google/Discord/Steam) are already absolute and pass through untouched.
  private absolutize(url: string | null): string | null {
    if (!url) return null;
    return /^https?:\/\//.test(url) ? url : `${this.siteUrl()}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  // ---- Meta-tag documents ----

  @Get('hub')
  async hubMeta(@Res() res: Response) {
    try {
      const games = await this.prisma.game.count();
      this.sendMeta(res, {
        title: 'Saveboxd — Le Letterboxd du jeu vidéo',
        description: `Synchronise tes bibliothèques Steam, PlayStation et Xbox, note tes jeux, débloque des succès et grimpe au classement global. ${games.toLocaleString('fr-FR')} jeux déjà au catalogue.`,
        imageUrl: this.imageUrl('hub'),
        canonicalUrl: this.siteUrl(),
      });
    } catch {
      this.sendFallback(res);
    }
  }

  @Get('catalog')
  async catalogMeta(@Res() res: Response) {
    try {
      const total = await this.prisma.game.count();
      this.sendMeta(res, {
        title: `Catalogue — ${total.toLocaleString('fr-FR')} jeux · Saveboxd`,
        description: 'Explore, note et critique des milliers de jeux sur Saveboxd.',
        imageUrl: this.imageUrl('catalog'),
        canonicalUrl: `${this.siteUrl()}/games`,
      });
    } catch {
      this.sendFallback(res);
    }
  }

  @Get('game/:id')
  async gameMeta(
    @Param('id', ParseIntPipe) id: number,
    @Query('review') reviewId: string | undefined,
    @Res() res: Response,
  ) {
    if (reviewId) return this.reviewMeta(Number(reviewId), res);
    try {
      const game = await this.games.findById(id);
      const stats = await this.reviews.getAverageRating({ gameId: id });
      const description =
        stats._count > 0
          ? `Noté ${(stats._avg.rating! / 2).toFixed(1)}/5 par ${stats._count} joueur${stats._count > 1 ? 's' : ''} sur Saveboxd.`
          : (game.summary?.slice(0, 180) ?? 'Découvre ce jeu sur Saveboxd.');
      this.sendMeta(res, {
        title: `${game.title} — Saveboxd`,
        description,
        imageUrl: this.imageUrl(`game/${id}`),
        canonicalUrl: `${this.siteUrl()}/game/${id}`,
      });
    } catch {
      this.sendFallback(res);
    }
  }

  @Get('company/:id')
  async companyMeta(
    @Param('id', ParseIntPipe) id: number,
    @Query('review') reviewId: string | undefined,
    @Res() res: Response,
  ) {
    if (reviewId) return this.reviewMeta(Number(reviewId), res);
    try {
      const company = await this.companies.findById(id);
      const stats = await this.reviews.getAverageRating({ companyId: id });
      const description = `${company._count.games} jeux · ${stats._count} avis sur Saveboxd.`;
      this.sendMeta(res, {
        title: `${company.name} — Saveboxd`,
        description,
        imageUrl: this.imageUrl(`company/${id}`),
        canonicalUrl: `${this.siteUrl()}/company/${id}`,
      });
    } catch {
      this.sendFallback(res);
    }
  }

  @Get('profile/:username')
  async profileMeta(@Param('username') username: string, @Res() res: Response) {
    try {
      const profile = await this.users.getPublicProfile(username);
      if (!profile) throw new Error('not found');
      const description = `${profile.playedCount} jeux faits · ${profile.reviewCount} critiques sur Saveboxd.`;
      this.sendMeta(res, {
        title: `${profile.username} — Saveboxd`,
        description,
        imageUrl: this.imageUrl(`profile/${encodeURIComponent(username)}`),
        canonicalUrl: `${this.siteUrl()}/u/${profile.username}`,
        type: 'profile',
      });
    } catch {
      this.sendFallback(res);
    }
  }

  private async reviewMeta(reviewId: number, res: Response) {
    if (!Number.isFinite(reviewId)) return this.sendFallback(res);
    try {
      const review = await this.reviews.findOne(reviewId);
      const target = review.game ?? review.company;
      if (!target) throw new Error('orphan review');
      const base = review.game ? `game/${review.game.id}` : `company/${review.company!.id}`;
      const targetName = review.game?.title ?? review.company?.name ?? '';
      const author = review.user?.username ?? 'un joueur supprimé';
      const excerpt = (review.title ?? review.text ?? '').slice(0, 150);
      this.sendMeta(res, {
        title: `${targetName} — critique de ${author} · Saveboxd`,
        description: excerpt || `${author} a noté ${targetName} sur Saveboxd.`,
        imageUrl: this.imageUrl(`review/${reviewId}`),
        canonicalUrl: `${this.siteUrl()}/${base}?review=${reviewId}`,
        type: 'article',
      });
    } catch {
      this.sendFallback(res);
    }
  }

  private sendMeta(
    res: Response,
    input: { title: string; description: string; imageUrl: string; canonicalUrl: string; type?: 'website' | 'article' | 'profile' },
  ) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=600');
    res.send(metaHtml(input));
  }

  private sendFallback(res: Response) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(404);
    res.send(
      metaHtml({
        title: 'Introuvable — Saveboxd',
        description: 'Ce contenu a été supprimé ou n’existe pas.',
        imageUrl: this.imageUrl('fallback'),
        canonicalUrl: this.siteUrl(),
      }),
    );
  }

  // ---- PNG cards (1200x630) ----

  @Get('image/game/:id')
  async gameImage(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    this.sendPng(
      res,
      `game-${id}`,
      async () => {
        const [game, stats] = await Promise.all([
          this.games.findById(id),
          this.reviews.getAverageRating({ gameId: id }),
        ]);
        return gameCard({
          title: game.title,
          coverUrl: game.coverUrl,
          avg: stats._count > 0 ? stats._avg.rating! : null,
          count: stats._count,
          genres: game.genres.map((g) => g.name),
        });
      },
    );
  }

  @Get('image/company/:id')
  async companyImage(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    this.sendPng(res, `company-${id}`, async () => {
      const company = await this.companies.findById(id);
      const stats = await this.reviews.getAverageRating({ companyId: id });
      return companyCard({
        name: company.name,
        logoUrl: company.logoUrl,
        gameCount: company._count.games,
        reviewCount: stats._count,
      });
    });
  }

  @Get('image/review/:id')
  async reviewImage(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    this.sendPng(res, `review-${id}`, async () => {
      const review = await this.reviews.findOne(id);
      return reviewCard({
        gameTitle: review.game?.title ?? null,
        companyName: review.company?.name ?? null,
        coverUrl: review.game?.coverUrl ?? review.company?.logoUrl ?? null,
        username: review.user?.username ?? '?',
        avatarUrl: this.absolutize(review.user?.avatarUrl ?? null),
        rating: review.rating,
        text: review.text,
        title: review.title,
      });
    });
  }

  @Get('image/profile/:username')
  async profileImage(@Param('username') username: string, @Res() res: Response) {
    this.sendPng(res, `profile-${username.toLowerCase()}`, async () => {
      const profile = await this.users.getPublicProfile(username);
      if (!profile) throw new Error('not found');
      return profileCard({
        username: profile.username,
        avatarUrl: this.absolutize(profile.avatarUrl),
        reviewCount: profile.reviewCount,
        playedCount: profile.playedCount,
        rank: profile.rank?.rank ?? null,
        topCovers: profile.topGames.map((t) => t.game.coverUrl).filter((c): c is string => !!c),
      });
    });
  }

  @Get('image/hub')
  async hubImage(@Res() res: Response) {
    this.sendPng(res, 'hub', async () => {
      const [games, reviews, players, covers] = await Promise.all([
        this.prisma.game.count(),
        this.prisma.review.count(),
        this.prisma.user.count(),
        this.popularCovers(6),
      ]);
      return hubCard({
        title: 'Ta bibliothèque. Notée, critiquée, partagée.',
        subtitle:
          'Synchronise tes bibliothèques Steam, PlayStation et Xbox, note tes jeux, débloque des succès et grimpe au classement global.',
        games,
        reviews,
        players,
        covers,
      });
    });
  }

  @Get('image/catalog')
  async catalogImage(@Res() res: Response) {
    this.sendPng(res, 'catalog', async () => {
      const [total, covers] = await Promise.all([this.prisma.game.count(), this.popularCovers(8)]);
      return catalogCard({ total, covers });
    });
  }

  @Get('image/fallback')
  async fallbackImage(@Res() res: Response) {
    const buf = await this.render.png('fallback', fallbackCard(), 1200, 630);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  }

  private async sendPng(res: Response, cacheKey: string, build: () => Promise<SatoriNode>) {
    let buf: Buffer;
    try {
      const tree = await build();
      buf = await this.render.png(cacheKey, tree, 1200, 630);
    } catch (err) {
      this.logger.warn(`OG image render failed for ${cacheKey}: ${(err as Error).message}`);
      buf = await this.render.png('fallback', fallbackCard(), 1200, 630);
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  }
}
