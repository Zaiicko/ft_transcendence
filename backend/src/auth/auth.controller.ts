import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { AuthProvider, User } from '@prisma/client';
import { Request, Response } from 'express';
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Post('signup')
  @HttpCode(201)
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.signup(dto);
    this.setAuthCookies(res, await this.auth.issueTokens(user));
    return toPublicUser(user);
  }

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
  @Post('resend-verification')
  @HttpCode(204)
  async resendVerification(@CurrentUser() current: JwtPayload) {
    const user = await this.users.findById(current.sub);
    if (user) await this.auth.requestEmailVerification(user);
  }

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    // Always the same response, whether or not that email is registered.
    return { message: 'If that email is registered, a reset link has been sent.' };
  }

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

  private async completeOAuth(provider: AuthProvider, profile: OAuthProfile, res: Response) {
    let user: User;
    let isNewUser: boolean;
    try {
      ({ user, isNewUser } = await this.auth.findOrCreateOAuthUser(
        provider,
        profile.providerId,
        profile.email,
        profile.displayName,
      ));
    } catch (err) {
      if (err instanceof ConflictException) {
        res.redirect(`${this.frontendUrl()}/login?error=email_in_use`);
        return;
      }
      throw err;
    }

    this.setAuthCookies(res, await this.auth.issueTokens(user));
    res.redirect(`${this.frontendUrl()}/profile${isNewUser ? '?welcome=1' : ''}`);
  }

  private frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL') ?? 'https://localhost:8443';
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
