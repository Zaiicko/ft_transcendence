import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { AuthProvider, User } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { hashPassword, verifyPassword } from './password.util';

export interface JwtPayload {
  sub: number;
  username: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTtlMs: number;
  refreshTtlMs: number;
}

const REFRESH_TOKEN_BYTES = 48;
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
  ) {}

  async signup(dto: SignupDto): Promise<User> {
    if (await this.users.findByEmail(dto.email)) {
      throw new ConflictException('Email already in use');
    }
    if (await this.users.findByUsername(dto.username)) {
      throw new ConflictException('Username already taken');
    }

    const passwordHash = await hashPassword(dto.password);
    return this.users.create({
      email: dto.email,
      username: dto.username,
      passwordHash,
      provider: AuthProvider.LOCAL,
    });
  }

  async validateLocalLogin(dto: LoginDto): Promise<User> {
    const user = await this.users.findByEmail(dto.email);
    const valid = user?.passwordHash ? await verifyPassword(user.passwordHash, dto.password) : false;
    if (!valid || !user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }

  // OAuth accounts are matched strictly by (provider, providerId) — a LOCAL
  // account with the same email is a distinct account, not auto-linked.
  async findOrCreateOAuthUser(
    provider: AuthProvider,
    providerId: string,
    email: string,
    displayName: string,
  ): Promise<User> {
    const existing = await this.prisma.user.findFirst({ where: { provider, providerId } });
    if (existing) return existing;

    const base =
      (displayName || email.split('@')[0])
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20) || 'player';
    let username = base;
    let suffix = 0;
    while (await this.users.findByUsername(username)) {
      suffix += 1;
      username = `${base}${suffix}`;
    }

    return this.users.create({ email, username, provider, providerId });
  }

  async issueTokens(user: User): Promise<TokenPair> {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtlMs = this.parseDurationMs(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d');

    const payload: JwtPayload = { sub: user.id, username: user.username };
    // JwtSignOptions.expiresIn is typed against the `ms` package's branded string
    // union (e.g. "15m"), which a plain `string` from ConfigService can't satisfy structurally.
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: accessTtl } as JwtSignOptions);

    const rawRefreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(rawRefreshToken),
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
    const tokenHash = this.hashToken(rawRefreshToken);
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
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private parseDurationMs(duration: string): number {
    const match = /^(\d+)(s|m|h|d)$/.exec(duration);
    if (!match) return DURATION_UNIT_MS.m * 15;
    return Number(match[1]) * DURATION_UNIT_MS[match[2]];
  }
}
