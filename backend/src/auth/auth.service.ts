import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { AuthProvider, Prisma, User, VerificationTokenType } from '@prisma/client';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { hashPassword, verifyPassword } from './password.util';
import { generateOpaqueToken, hashToken } from './token.util';

// `purpose` discriminates a full session token from an in-progress 2FA
// challenge — both are signed with the same JWT_SECRET, so without this,
// a token issued for step 1 of login (password OK, 2FA pending) could be
// replayed as a full session by putting it in the access_token cookie.
export interface JwtPayload {
  sub: number;
  username: string;
  purpose: 'session';
}

export interface MfaPendingPayload {
  sub: number;
  purpose: 'mfa';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTtlMs: number;
  refreshTtlMs: number;
}

const REFRESH_TOKEN_BYTES = 48;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const RESEND_VERIFICATION_COOLDOWN_MS = 60 * 1000;
const MFA_CHALLENGE_TTL = '5m';

const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
  ) {}

  async signup(dto: SignupDto): Promise<User> {
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException('Email already in use');
    }

    // The username is picked later in the onboarding wizard: validate it when
    // supplied, otherwise derive a unique one from the email, as OAuth does.
    let username: string;
    if (dto.username) {
      if (await this.users.findByUsername(dto.username)) {
        throw new ConflictException('Username already taken');
      }
      username = dto.username;
    } else {
      username = await this.generateUniqueUsername(dto.email.split('@')[0]);
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.users.create({
      email: dto.email,
      username,
      passwordHash,
      provider: AuthProvider.LOCAL,
    });
    await this.requestEmailVerification(user);
    return user;
  }

  // Derives a unique username from a label (OAuth display name or the local
  // part of an email): lowercase, allowed characters only, then a numeric
  // suffix on collision. Shared by classic signup and OAuth.
  private async generateUniqueUsername(seed: string): Promise<string> {
    const base = seed.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'player';
    let username = base;
    let suffix = 0;
    while (await this.users.findByUsername(username)) {
      suffix += 1;
      username = `${base}${suffix}`;
    }
    return username;
  }

  async validateLocalLogin(dto: LoginDto): Promise<User> {
    // Usernames never contain '@' (enforced at signup), so this is unambiguous.
    const user = dto.identifier.includes('@')
      ? await this.users.findByEmail(dto.identifier)
      : await this.users.findByUsername(dto.identifier);
    const valid = user?.passwordHash ? await verifyPassword(user.passwordHash, dto.password) : false;
    if (!valid || !user) {
      throw new UnauthorizedException('Invalid email/username or password');
    }
    return user;
  }

  // OAuth accounts are matched strictly by (provider, providerId) — a LOCAL
  // account (or a different provider) with the same email is never silently
  // linked; the caller gets a clear conflict instead of a duplicate-email
  // crash from the DB.
  async findOrCreateOAuthUser(
    provider: AuthProvider,
    providerId: string,
    email: string,
    displayName: string,
    avatarUrl?: string,
  ): Promise<{ user: User; isNewUser: boolean }> {
    const existing = await this.prisma.user.findFirst({ where: { provider, providerId } });
    if (existing) return { user: existing, isNewUser: false };

    if (await this.users.findByEmail(email)) {
      throw new ConflictException('An account already exists with this email address');
    }

    const username = await this.generateUniqueUsername(displayName || email.split('@')[0]);

    try {
      // The provider already verified this email address.
      const user = await this.users.create({
        email,
        username,
        provider,
        providerId,
        emailVerifiedAt: new Date(),
        // Adopt the provider's profile picture once, at creation only
        avatarUrl: avatarUrl ?? undefined,
      });
      return { user, isNewUser: true };
    } catch (err) {
      // Closes the race between the findByEmail check above and this create —
      // a concurrent signup with the same email hits the DB's unique
      // constraint instead of the pre-check.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account already exists with this email address');
      }
      throw err;
    }
  }

  async issueTokens(user: User): Promise<TokenPair> {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtlMs = this.parseDurationMs(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d');

    const payload: JwtPayload = { sub: user.id, username: user.username, purpose: 'session' };
    // JwtSignOptions.expiresIn is typed against the `ms` package's branded string
    // union (e.g. "15m"), which a plain `string` from ConfigService can't satisfy structurally.
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: accessTtl } as JwtSignOptions);

    const rawRefreshToken = generateOpaqueToken(REFRESH_TOKEN_BYTES);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      accessTtlMs: this.parseDurationMs(accessTtl),
      refreshTtlMs,
    };
  }

  async refresh(rawRefreshToken: string): Promise<{ user: User; tokens: TokenPair }> {
    const tokenHash = hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(stored.user);
    return { user: stored.user, tokens };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---------- Email verification ----------

  async requestEmailVerification(user: User): Promise<void> {
    if (user.emailVerifiedAt) return;

    const recent = await this.prisma.verificationToken.findFirst({
      where: {
        userId: user.id,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        createdAt: { gt: new Date(Date.now() - RESEND_VERIFICATION_COOLDOWN_MS) },
      },
    });
    if (recent) return;

    const rawToken = generateOpaqueToken();
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });

    const link = `${this.frontendUrl()}/verify-email?token=${rawToken}`;
    await this.mailer.send({
      to: user.email,
      subject: 'Confirm your Saveboxd email',
      html: `<p>Welcome to Saveboxd! Confirm your email address:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const record = await this.consumeVerificationToken(rawToken, VerificationTokenType.EMAIL_VERIFICATION);
    await this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
  }

  // ---------- Password reset ----------

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.passwordHash) return; // never reveal whether the account exists

    const rawToken = generateOpaqueToken();
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: VerificationTokenType.PASSWORD_RESET,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    const link = `${this.frontendUrl()}/reset-password?token=${rawToken}`;
    await this.mailer.send({
      to: user.email,
      subject: 'Reset your Saveboxd password',
      html: `<p>Reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
    });
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.consumeVerificationToken(rawToken, VerificationTokenType.PASSWORD_RESET);
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async consumeVerificationToken(rawToken: string, type: VerificationTokenType) {
    const tokenHash = hashToken(rawToken);
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.type !== type || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    await this.prisma.verificationToken.delete({ where: { id: record.id } });
    return record;
  }

  // ---------- 2FA (TOTP) ----------

  async beginTwoFactorSetup(userId: number): Promise<{ otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();

    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });

    const otpauthUrl = authenticator.keyuri(user.email, 'Saveboxd', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    return { otpauthUrl, qrCodeDataUrl };
  }

  async confirmTwoFactorSetup(userId: number, code: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.twoFactorSecret) throw new UnauthorizedException('2FA setup not started');
    if (!authenticator.verify({ token: code, secret: user.twoFactorSecret })) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  }

  async disableTwoFactor(userId: number, code: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.twoFactorSecret || !authenticator.verify({ token: code, secret: user.twoFactorSecret })) {
      throw new UnauthorizedException('Invalid code');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
  }

  issueMfaChallenge(userId: number): Promise<string> {
    const payload: MfaPendingPayload = { sub: userId, purpose: 'mfa' };
    return this.jwt.signAsync(payload, { expiresIn: MFA_CHALLENGE_TTL } as JwtSignOptions);
  }

  async completeMfaChallenge(challengeToken: string, code: string): Promise<User> {
    let payload: MfaPendingPayload;
    try {
      payload = await this.jwt.verifyAsync<MfaPendingPayload>(challengeToken, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired 2FA challenge');
    }
    if (payload.purpose !== 'mfa') throw new UnauthorizedException('Invalid 2FA challenge');

    const user = await this.users.findById(payload.sub);
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) throw new UnauthorizedException();
    if (!authenticator.verify({ token: code, secret: user.twoFactorSecret })) {
      throw new UnauthorizedException('Invalid code');
    }
    return user;
  }

  private frontendUrl(): string {
    // Tolerates a trailing slash in .env: without this, `${base}/x` yields
    // "//x" — a 404 on the Steam callback and broken redirects and email links
    const url = this.config.get<string>('FRONTEND_URL') ?? 'https://localhost:8443';
    return url.replace(/\/+$/, '');
  }

  private parseDurationMs(duration: string): number {
    const match = /^(\d+)(s|m|h|d)$/.exec(duration);
    if (!match) return DURATION_UNIT_MS.m * 15;
    return Number(match[1]) * DURATION_UNIT_MS[match[2]];
  }
}
