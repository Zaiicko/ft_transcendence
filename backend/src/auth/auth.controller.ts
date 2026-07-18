import {
  Body,
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
import { AuthProvider } from '@prisma/client';
import { Request, Response } from 'express';
import { toPublicUser } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { clearAuthCookies, setAuthCookies } from './auth-cookies.util';
import { AuthService, JwtPayload, TokenPair } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { OAuthProfile } from './google.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';

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
    const user = await this.auth.findOrCreateOAuthUser(
      provider,
      profile.providerId,
      profile.email,
      profile.displayName,
    );
    this.setAuthCookies(res, await this.auth.issueTokens(user));
    res.redirect(this.config.get<string>('FRONTEND_URL') ?? '/');
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
