import { Controller, Get, Logger, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CompaniesService } from '../companies/companies.service';
import { GameSort, ListGamesDto, SortDir } from '../games/dto/list-games.dto';
import { GamesService } from '../games/games.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService } from '../reviews/reviews.service';
import { UsersService } from '../users/users.service';
import { catalogCard, companyCard, fallbackCard, fmtCount, gameCard, hubCard, profileCard, reviewCard } from './og-cards';
import { OG_I18N, OgLang, resolveOgLang, reviewsCount } from './og-i18n';
import { metaHtml } from './og-meta';
import { OgRenderService, SatoriNode } from './og-render.service';

// Server-rendered meta tags + PNG cards, for crawlers only (Discord, X,
// Slack, iMessage, ...). Nginx routes bot user-agents on /game/:id, /company/:id,
// /u/:username, / and /games here instead of the SPA — real browsers never
// see this controller. Because those crawlers never execute JS, the SPA's
// client-side <title>/meta (which doesn't exist anyway) could never reach
// them.
//
// Language: a preview is fetched ONCE per URL by the crawler and cached by
// the platform for everyone who later sees that message/embed — there is no
// "current viewer" to adapt to. So localisation happens at SHARE time: the
// frontend tags the URL with ?lang=<code> (the sharer's own active language,
// see frontend/src/lib/useOgLangSync.ts), and that's what gets baked into
// the resulting card. No ?lang= (or an unsupported one) → English, matching
// the SPA's own fallbackLng.
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
  // no user-agent sniffing needed there. Carries ?lang= along so the image
  // matches the meta document that references it.
  private imageUrl(path: string, lang: OgLang): string {
    return `${this.siteUrl()}/api/og/image/${path}${lang !== 'en' ? `?lang=${lang}` : ''}`;
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
  async hubMeta(@Query('lang') langRaw: string | undefined, @Res() res: Response) {
    const lang = resolveOgLang(langRaw);
    const T = OG_I18N[lang];
    try {
      const games = await this.prisma.game.count();
      this.sendMeta(res, {
        title: `Saveboxd — ${T.eyebrowHub}`,
        description: `${T.hubSubtitle} ${T.gamesInCatalog(fmtCount(games))}`,
        imageUrl: this.imageUrl('hub', lang),
        canonicalUrl: this.siteUrl(),
      });
    } catch {
      this.sendFallback(res, lang);
    }
  }

  @Get('catalog')
  async catalogMeta(@Query('lang') langRaw: string | undefined, @Res() res: Response) {
    const lang = resolveOgLang(langRaw);
    const T = OG_I18N[lang];
    try {
      const total = await this.prisma.game.count();
      this.sendMeta(res, {
        title: `${T.eyebrowCatalog} — ${T.gamesToExplore(fmtCount(total))} · Saveboxd`,
        description: `${T.gamesToExplore(fmtCount(total))} · Saveboxd`,
        imageUrl: this.imageUrl('catalog', lang),
        canonicalUrl: `${this.siteUrl()}/games`,
      });
    } catch {
      this.sendFallback(res, lang);
    }
  }

  @Get('game/:id')
  async gameMeta(
    @Param('id', ParseIntPipe) id: number,
    @Query('review') reviewId: string | undefined,
    @Query('lang') langRaw: string | undefined,
    @Res() res: Response,
  ) {
    const lang = resolveOgLang(langRaw);
    if (reviewId) return this.reviewMeta(Number(reviewId), lang, res);
    const T = OG_I18N[lang];
    try {
      const game = await this.games.findById(id, lang);
      const stats = await this.reviews.getAverageRating({ gameId: id });
      const description =
        stats._count > 0
          ? `${(stats._avg.rating! / 2).toFixed(1)}/5 (${reviewsCount(stats._count, lang)}) · Saveboxd`
          : (game.summary?.slice(0, 180) ?? T.discoverGame);
      this.sendMeta(res, {
        title: `${game.title} — Saveboxd`,
        description,
        imageUrl: this.imageUrl(`game/${id}`, lang),
        canonicalUrl: `${this.siteUrl()}/game/${id}`,
      });
    } catch {
      this.sendFallback(res, lang);
    }
  }

  @Get('company/:id')
  async companyMeta(
    @Param('id', ParseIntPipe) id: number,
    @Query('review') reviewId: string | undefined,
    @Query('lang') langRaw: string | undefined,
    @Res() res: Response,
  ) {
    const lang = resolveOgLang(langRaw);
    if (reviewId) return this.reviewMeta(Number(reviewId), lang, res);
    const T = OG_I18N[lang];
    try {
      const company = await this.companies.findById(id);
      const stats = await this.reviews.getAverageRating({ companyId: id });
      const description = `${company._count.games} ${T.gamesWord} · ${reviewsCount(stats._count, lang)} · Saveboxd`;
      this.sendMeta(res, {
        title: `${company.name} — Saveboxd`,
        description,
        imageUrl: this.imageUrl(`company/${id}`, lang),
        canonicalUrl: `${this.siteUrl()}/company/${id}`,
      });
    } catch {
      this.sendFallback(res, lang);
    }
  }

  @Get('profile/:username')
  async profileMeta(
    @Param('username') username: string,
    @Query('lang') langRaw: string | undefined,
    @Res() res: Response,
  ) {
    const lang = resolveOgLang(langRaw);
    const T = OG_I18N[lang];
    try {
      const profile = await this.users.getPublicProfile(username);
      if (!profile) throw new Error('not found');
      const description = `${profile.playedCount} ${T.playedWord} · ${reviewsCount(profile.reviewCount, lang)} · Saveboxd`;
      this.sendMeta(res, {
        title: `${profile.username} — Saveboxd`,
        description,
        imageUrl: this.imageUrl(`profile/${encodeURIComponent(username)}`, lang),
        canonicalUrl: `${this.siteUrl()}/u/${profile.username}`,
        type: 'profile',
      });
    } catch {
      this.sendFallback(res, lang);
    }
  }

  private async reviewMeta(reviewId: number, lang: OgLang, res: Response) {
    const T = OG_I18N[lang];
    if (!Number.isFinite(reviewId)) return this.sendFallback(res, lang);
    try {
      const review = await this.reviews.findOne(reviewId);
      const target = review.game ?? review.company;
      if (!target) throw new Error('orphan review');
      const base = review.game ? `game/${review.game.id}` : `company/${review.company!.id}`;
      const targetName = review.game?.title ?? review.company?.name ?? '';
      const author = review.user?.username ?? T.deletedUser;
      const translated = lang !== 'en' ? await this.reviews.translateReview(reviewId, lang).catch(() => null) : null;
      const excerpt = (translated?.title ?? review.title ?? translated?.text ?? review.text ?? '').slice(0, 150);
      this.sendMeta(res, {
        title: T.reviewTitle(targetName, author),
        description: excerpt || T.reviewTitle(targetName, author),
        imageUrl: this.imageUrl(`review/${reviewId}`, lang),
        canonicalUrl: `${this.siteUrl()}/${base}?review=${reviewId}`,
        type: 'article',
      });
    } catch {
      this.sendFallback(res, lang);
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

  private sendFallback(res: Response, lang: OgLang) {
    const T = OG_I18N[lang];
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(404);
    res.send(
      metaHtml({
        title: T.notFoundTitle,
        description: T.notFoundDescription,
        imageUrl: this.imageUrl('fallback', lang),
        canonicalUrl: this.siteUrl(),
      }),
    );
  }

  // ---- PNG cards (1200x630) ----

  @Get('image/game/:id')
  async gameImage(
    @Param('id', ParseIntPipe) id: number,
    @Query('lang') langRaw: string | undefined,
    @Res() res: Response,
  ) {
    const lang = resolveOgLang(langRaw);
    this.sendPng(res, `game-${id}-${lang}`, async () => {
      const [game, stats] = await Promise.all([
        this.games.findById(id, lang),
        this.reviews.getAverageRating({ gameId: id }),
      ]);
      return gameCard({
        title: game.title,
        coverUrl: game.coverUrl,
        avg: stats._count > 0 ? stats._avg.rating! : null,
        count: stats._count,
        genres: game.genres.map((g) => g.name),
        lang,
      });
    });
  }

  @Get('image/company/:id')
  async companyImage(
    @Param('id', ParseIntPipe) id: number,
    @Query('lang') langRaw: string | undefined,
    @Res() res: Response,
  ) {
    const lang = resolveOgLang(langRaw);
    this.sendPng(res, `company-${id}-${lang}`, async () => {
      const company = await this.companies.findById(id);
      const stats = await this.reviews.getAverageRating({ companyId: id });
      return companyCard({
        name: company.name,
        logoUrl: company.logoUrl,
        gameCount: company._count.games,
        reviewCount: stats._count,
        lang,
      });
    });
  }

  @Get('image/review/:id')
  async reviewImage(
    @Param('id', ParseIntPipe) id: number,
    @Query('lang') langRaw: string | undefined,
    @Res() res: Response,
  ) {
    const lang = resolveOgLang(langRaw);
    this.sendPng(res, `review-${id}-${lang}`, async () => {
      const review = await this.reviews.findOne(id);
      const translated =
        lang !== 'en' ? await this.reviews.translateReview(id, lang).catch(() => null) : null;
      return reviewCard({
        gameTitle: review.game?.title ?? null,
        companyName: review.company?.name ?? null,
        coverUrl: review.game?.coverUrl ?? review.company?.logoUrl ?? null,
        username: review.user?.username ?? '?',
        avatarUrl: this.absolutize(review.user?.avatarUrl ?? null),
        rating: review.rating,
        text: translated?.text ?? review.text,
        title: translated?.title ?? review.title,
        lang,
      });
    });
  }

  @Get('image/profile/:username')
  async profileImage(
    @Param('username') username: string,
    @Query('lang') langRaw: string | undefined,
    @Res() res: Response,
  ) {
    const lang = resolveOgLang(langRaw);
    this.sendPng(res, `profile-${username.toLowerCase()}-${lang}`, async () => {
      const profile = await this.users.getPublicProfile(username);
      if (!profile) throw new Error('not found');
      return profileCard({
        username: profile.username,
        avatarUrl: this.absolutize(profile.avatarUrl),
        reviewCount: profile.reviewCount,
        playedCount: profile.playedCount,
        rank: profile.rank?.rank ?? null,
        topCovers: profile.topGames.map((t) => t.game.coverUrl).filter((c): c is string => !!c),
        lang,
      });
    });
  }

  @Get('image/hub')
  async hubImage(@Query('lang') langRaw: string | undefined, @Res() res: Response) {
    const lang = resolveOgLang(langRaw);
    this.sendPng(res, `hub-${lang}`, async () => {
      const [games, reviews, players, covers] = await Promise.all([
        this.prisma.game.count(),
        this.prisma.review.count(),
        this.prisma.user.count(),
        this.popularCovers(6),
      ]);
      return hubCard({ games, reviews, players, covers, lang });
    });
  }

  @Get('image/catalog')
  async catalogImage(@Query('lang') langRaw: string | undefined, @Res() res: Response) {
    const lang = resolveOgLang(langRaw);
    this.sendPng(res, `catalog-${lang}`, async () => {
      const [total, covers] = await Promise.all([this.prisma.game.count(), this.popularCovers(8)]);
      return catalogCard({ total, covers, lang });
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
