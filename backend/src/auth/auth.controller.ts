import {
  BadRequestException,
  Body,
  ConflictException,
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
import { ModuleRef } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthProvider, User } from '@prisma/client';
import { Request, Response } from 'express';
import { FriendsService } from '../friends/friends.service';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { clearAuthCookies, REFRESH_COOKIE_PATH, setAuthCookies } from './auth-cookies.util';
import { AuthService, JwtPayload, TokenPair } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SignupDto } from './dto/signup.dto';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { OAuthProfile } from './google.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

// Must match AuthService's MFA_CHALLENGE_TTL ('5m') — the cookie should
// never outlive the JWT it carries.
const MFA_CHALLENGE_COOKIE_MAX_AGE_MS = 5 * 60 * 1000;

// Tighter than the app-wide default (120/min) — these routes are exactly
// what credential-stuffing / spam / 2FA-guessing target.
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

// Preuve courte, signée, du user qui rattache son Discord — portée entre le
// départ vers Discord et le callback. Le userId vient du JWT, jamais du query.
const DISCORD_LINK_COOKIE = 'discord_link';
const DISCORD_LINK_COOKIE_PATH = '/api/auth/discord';
const DISCORD_LINK_TTL = '10m';
interface DiscordLinkPayload {
  purpose: 'discord_link';
  userId: number;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    // Résolu en lazy pour notifier les contacts d'un nouvel inscrit sans créer
    // de cycle de modules (Auth ↔ Friends ↔ Chat/Notifications).
    private readonly moduleRef: ModuleRef,
  ) {}

  @Throttle(AUTH_THROTTLE)
  @Post('signup')
  @HttpCode(201)
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.signup(dto);
    this.setAuthCookies(res, await this.auth.issueTokens(user));
    return toPublicUser(user);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateLocalLogin(dto);

    if (user.twoFactorEnabled) {
      const challenge = await this.auth.issueMfaChallenge(user.id);
      res.cookie('mfa_pending', challenge, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: REFRESH_COOKIE_PATH,
        maxAge: MFA_CHALLENGE_COOKIE_MAX_AGE_MS,
      });
      return { requiresTwoFactor: true };
    }

    this.setAuthCookies(res, await this.auth.issueTokens(user));
    return toPublicUser(user);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('2fa/verify-login')
  @HttpCode(200)
  async verifyLoginTwoFactor(
    @Req() req: Request,
    @Body() dto: TwoFactorCodeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const challenge = req.cookies?.mfa_pending;
    if (!challenge) throw new UnauthorizedException('No pending 2FA challenge');

    const user = await this.auth.completeMfaChallenge(challenge, dto.code);
    res.clearCookie('mfa_pending', { path: REFRESH_COOKIE_PATH });
    this.setAuthCookies(res, await this.auth.issueTokens(user));
    return toPublicUser(user);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.refresh_token;
    if (!raw) throw new UnauthorizedException('Missing refresh token');
    const { user, tokens } = await this.auth.refresh(raw);
    this.setAuthCookies(res, tokens);
    return toPublicUser(user);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.refresh_token;
    if (raw) await this.auth.logout(raw);
    this.clearAuthCookies(res);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    return toPublicUser(user);
  }

  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_THROTTLE)
  @Post('resend-verification')
  @HttpCode(204)
  async resendVerification(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (user) await this.auth.requestEmailVerification(user);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    // Always the same response, whether or not that email is registered.
    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() current: JwtPayload) {
    return this.auth.beginTwoFactorSetup(current.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/enable')
  @HttpCode(204)
  async enableTwoFactor(@CurrentUser() current: JwtPayload, @Body() dto: TwoFactorCodeDto) {
    await this.auth.confirmTwoFactorSetup(current.sub, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  @HttpCode(204)
  async disableTwoFactor(@CurrentUser() current: JwtPayload, @Body() dto: TwoFactorCodeDto) {
    await this.auth.disableTwoFactor(current.sub, dto.code);
  }

  // Passport's guard handles the redirect to Google's consent screen —
  // this handler body never actually runs for this route.
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    await this.completeOAuth(AuthProvider.GOOGLE, req.user as OAuthProfile, res);
  }

  @Get('42')
  @UseGuards(AuthGuard('fortytwo'))
  fortyTwoLogin() {}

  @Get('42/callback')
  @UseGuards(AuthGuard('fortytwo'))
  async fortyTwoCallback(@Req() req: Request, @Res() res: Response) {
    await this.completeOAuth(AuthProvider.FORTYTWO, req.user as OAuthProfile, res);
  }

  @Get('discord')
  @UseGuards(AuthGuard('discord'))
  discordLogin() {}

  // Rattachement d'un Discord à un compte déjà connecté. On mémorise le userId
  // (issu du JWT, jamais du query/body) dans un cookie signé court, puis on
  // envoie vers Discord — le callback distingue link vs login sur ce cookie.
  @UseGuards(JwtAuthGuard)
  @Get('discord/link')
  async discordLinkStart(@CurrentUser() current: JwtPayload, @Res() res: Response) {
    const token = await this.jwt.signAsync(
      { purpose: 'discord_link', userId: current.sub } satisfies DiscordLinkPayload,
      { expiresIn: DISCORD_LINK_TTL },
    );
    res.cookie(DISCORD_LINK_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: DISCORD_LINK_COOKIE_PATH,
      maxAge: 10 * 60_000,
    });
    res.redirect(this.discordAuthorizeUrl());
  }

  @Get('discord/callback')
  @UseGuards(AuthGuard('discord'))
  async discordCallback(@Req() req: Request, @Res() res: Response) {
    const profile = req.user as OAuthProfile;
    const front = this.frontendUrl();
    const intent = await this.readDiscordLinkIntent(req);

    // Mode rattachement : on attache le discordId au compte courant.
    if (intent) {
      res.clearCookie(DISCORD_LINK_COOKIE, { path: DISCORD_LINK_COOKIE_PATH });
      const owner = await this.prisma.user.findUnique({ where: { discordId: profile.providerId } });
      if (owner && owner.id !== intent.userId) {
        return res.redirect(`${front}/profile?link=discord_taken`);
      }
      await this.prisma.user.update({
        where: { id: intent.userId },
        data: { discordId: profile.providerId },
      });
      return res.redirect(`${front}/profile?link=discord_linked`);
    }

    // Mode connexion : on résout par discordId (comme Steam par steamId) ; sinon
    // c'est une première connexion Discord → création via completeOAuth.
    const owner = await this.prisma.user.findUnique({ where: { discordId: profile.providerId } });
    if (owner) {
      this.setAuthCookies(res, await this.auth.issueTokens(owner));
      return res.redirect(`${front}/profile`);
    }
    await this.completeOAuth(AuthProvider.DISCORD, profile, res);
  }

  // Délie le Discord. Garde-fou anti-lock-out : interdit si c'est la seule façon
  // de se connecter (compte né sur Discord sans mot de passe ni autre méthode).
  @UseGuards(JwtAuthGuard)
  @Delete('discord/link')
  @HttpCode(204)
  async unlinkDiscord(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (!user) throw new UnauthorizedException();
    if (!user.discordId) return; // déjà délié — idempotent
    if (!this.hasOtherLoginMethod(user, AuthProvider.DISCORD)) {
      throw new BadRequestException(
        'Add a password first — Discord is currently your only way to sign in',
      );
    }
    await this.prisma.user.update({
      where: { id: current.sub },
      data: { discordId: null },
    });
  }

  // URL d'autorisation Discord (identique au redirect_uri de la stratégie
  // passport pour que Discord l'accepte), construite à la main car on doit
  // poser le cookie d'intention avant la redirection.
  private discordAuthorizeUrl(): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.get<string>('DISCORD_CLIENT_ID') ?? '',
      redirect_uri:
        this.config.get<string>('DISCORD_CALLBACK_URL') ??
        `${this.frontendUrl()}/api/auth/discord/callback`,
      scope: 'identify email',
    });
    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
  }

  private async readDiscordLinkIntent(req: Request): Promise<DiscordLinkPayload | null> {
    const raw = (req.cookies as Record<string, string> | undefined)?.[DISCORD_LINK_COOKIE];
    if (!raw) return null;
    try {
      const payload = await this.jwt.verifyAsync<DiscordLinkPayload>(raw);
      return payload.purpose === 'discord_link' ? payload : null;
    } catch {
      return null;
    }
  }

  // Reste-t-il un moyen de se connecter si on retire `excluding` ?
  private hasOtherLoginMethod(user: User, excluding: AuthProvider): boolean {
    if (user.passwordHash) return true;
    if (excluding !== AuthProvider.STEAM && user.steamId) return true;
    // Google/42 restent utilisables via provider/providerId (pas de colonne dédiée)
    if (
      (user.provider === AuthProvider.GOOGLE || user.provider === AuthProvider.FORTYTWO) &&
      user.providerId
    ) {
      return true;
    }
    return false;
  }

  private async completeOAuth(provider: AuthProvider, profile: OAuthProfile, res: Response) {
    let user: User;
    let isNewUser: boolean;
    try {
      ({ user, isNewUser } = await this.auth.findOrCreateOAuthUser(
        provider,
        profile.providerId,
        profile.email,
        profile.displayName,
        profile.avatarUrl,
      ));
    } catch (err) {
      if (err instanceof ConflictException) {
        res.redirect(`${this.frontendUrl()}/login?error=email_in_use`);
        return;
      }
      throw err;
    }

    // Un compte né sur Discord garde son id aussi dans `discordId` (comme
    // steamId) : les connexions suivantes se résolvent par cette colonne.
    if (provider === AuthProvider.DISCORD && !user.discordId) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { discordId: profile.providerId },
      });
    }

    this.setAuthCookies(res, await this.auth.issueTokens(user));
    if (isNewUser) {
      // Prévient les camarades 42 / amis Steam déjà inscrits (best-effort)
      this.moduleRef
        .get(FriendsService, { strict: false })
        .notifyContactJoined(user.id)
        .catch(() => {});
    }
    res.redirect(`${this.frontendUrl()}/profile${isNewUser ? '?welcome=1' : ''}`);
  }

  private frontendUrl(): string {
    // Slash final toléré dans .env : sans ça, `${base}/x` produit "//x"
    // (callback Steam en 404, redirections et liens d'emails cassés)
    const url = this.config.get<string>('FRONTEND_URL') ?? 'https://localhost:8443';
    return url.replace(/\/+$/, '');
  }

  // Cookie mechanics live in auth-cookies.util.ts (shared with the Steam
  // account flow) — these wrappers keep the existing call sites unchanged.
  private setAuthCookies(res: Response, tokens: TokenPair) {
    setAuthCookies(res, tokens);
  }

  private clearAuthCookies(res: Response) {
    clearAuthCookies(res);
  }
}
