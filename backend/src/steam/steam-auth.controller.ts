import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider } from '@prisma/client';
import { Request, Response } from 'express';
import { setAuthCookies } from '../auth/auth-cookies.util';
import { AuthService, JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SteamRegisterDto } from './dto/steam-register.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { hashPassword } from '../auth/password.util';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { SteamOpenidService } from './steam-openid.service';
import { SteamWebApiService } from './steam-web-api.service';

// Short-lived proof that a steamId was verified via OpenID, carried between
// the callback and the register form completion
interface SteamPendingPayload {
  purpose: 'steam_register';
  steamId: string;
}

const PENDING_COOKIE = 'steam_pending';
const PENDING_COOKIE_PATH = '/api/auth/steam';
const PENDING_TTL = '10m';

@Controller('auth/steam')
export class SteamAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly openid: SteamOpenidService,
    private readonly webApi: SteamWebApiService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private frontendUrl(): string {
    // Slash final toléré dans .env : sans ça, `${base}/x` produit "//x"
    // (callback Steam en 404, redirections et liens d'emails cassés)
    const url = this.config.get<string>('FRONTEND_URL') ?? 'https://localhost:8443';
    return url.replace(/\/+$/, '');
  }

  // Single entry point for the three cases (login / link / register) — the
  // browser is redirected to Steam's "Sign in through Steam" page.
  @Get()
  toSteam(@Res() res: Response) {
    const base = this.frontendUrl();
    res.redirect(this.openid.buildLoginUrl(`${base}/api/auth/steam/callback`, base));
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get('callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() current?: JwtPayload,
  ) {
    const front = this.frontendUrl();
    const steamId = await this.openid.verifyAssertion(req.query as Record<string, unknown>);
    if (!steamId) return res.redirect(`${front}/login?steam=failed`);

    const owner = await this.prisma.user.findUnique({ where: { steamId } });

    // Case 1 — someone is logged in: link this Steam account to them
    if (current) {
      if (owner && owner.id !== current.sub) {
        return res.redirect(`${front}/profile?steam=taken`);
      }
      await this.prisma.user.update({
        where: { id: current.sub },
        data: { steamId },
      });
      return res.redirect(`${front}/profile?steam=linked`);
    }

    // Case 2 — this Steam account is already linked to a user: log them in
    if (owner) {
      setAuthCookies(res, await this.auth.issueTokens(owner));
      return res.redirect(front);
    }

    // Case 3 — unknown Steam account: hand the verified steamId to the
    // signup-completion form (Steam provides no email, the user picks one)
    const pending = await this.jwt.signAsync(
      { purpose: 'steam_register', steamId } satisfies SteamPendingPayload,
      { expiresIn: PENDING_TTL },
    );
    res.cookie(PENDING_COOKIE, pending, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: PENDING_COOKIE_PATH,
      maxAge: 10 * 60_000,
    });
    let suggestedName = '';
    try {
      suggestedName = (await this.webApi.getPersonaName(steamId)) ?? '';
    } catch {
      // No API key / Steam down: the form simply has no prefilled username
    }
    return res.redirect(
      `${front}/signup?steam=pending&name=${encodeURIComponent(suggestedName)}`,
    );
  }

  // Completes case 3: email/username chosen by the user (password optional),
  // steamId taken from the verified pending cookie — never from the body.
  @Post('register')
  @HttpCode(201)
  async register(
    @Req() req: Request,
    @Body() dto: SteamRegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = (req.cookies as Record<string, string> | undefined)?.[PENDING_COOKIE];
    if (!raw) throw new UnauthorizedException('No pending Steam sign-in — start from /api/auth/steam');

    let payload: SteamPendingPayload;
    try {
      payload = await this.jwt.verifyAsync<SteamPendingPayload>(raw);
    } catch {
      throw new UnauthorizedException('Steam sign-in expired — please retry');
    }
    if (payload.purpose !== 'steam_register') {
      throw new UnauthorizedException('Invalid pending token');
    }

    if (await this.prisma.user.findUnique({ where: { steamId: payload.steamId } })) {
      throw new BadRequestException('This Steam account is already linked');
    }
    if (await this.users.findByEmail(dto.email)) {
      throw new BadRequestException('Email already in use');
    }
    if (await this.users.findByUsername(dto.username)) {
      throw new BadRequestException('Username already taken');
    }

    const user = await this.users.create({
      email: dto.email,
      username: dto.username,
      passwordHash: dto.password ? await hashPassword(dto.password) : undefined,
      provider: AuthProvider.STEAM,
      steamId: payload.steamId,
    });

    res.clearCookie(PENDING_COOKIE, { path: PENDING_COOKIE_PATH });
    setAuthCookies(res, await this.auth.issueTokens(user));
    return toPublicUser(user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('link')
  @HttpCode(204)
  async unlink(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    // A Steam-born account with no password would be locked out forever
    if (user.provider === AuthProvider.STEAM && !user.passwordHash) {
      throw new BadRequestException(
        'Add a password first — Steam is currently your only way to sign in',
      );
    }
    await this.prisma.user.update({
      where: { id: current.sub },
      data: { steamId: null },
    });
  }
}
