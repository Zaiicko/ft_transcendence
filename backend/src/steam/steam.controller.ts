import {
  BadRequestException,
  Controller,
  Get,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { SteamWebApiService } from './steam-web-api.service';

@UseGuards(JwtAuthGuard)
@Controller('steam')
export class SteamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly webApi: SteamWebApiService,
  ) {}

  private async requireSteamId(userId: number): Promise<string> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (!user.steamId) {
      throw new BadRequestException('No Steam account linked — visit /api/auth/steam first');
    }
    return user.steamId;
  }

  // The user's Steam library, matched against our catalog through the
  // steamAppId mapping. The frontend lists these so the user can mark them
  // played / rate them (existing reviews & playedGame endpoints).
  @Get('library')
  async library(@CurrentUser() current: JwtPayload) {
    const steamId = await this.requireSteamId(current.sub);

    const owned = await this.webApi.getOwnedGames(steamId);
    if (owned === null) {
      return { private: true, totalOwned: 0, matched: [], unmatchedCount: 0 };
    }

    const byAppId = new Map(owned.map((g) => [g.appid, g]));
    const games = await this.prisma.game.findMany({
      where: { steamAppId: { in: [...byAppId.keys()] } },
      select: {
        id: true,
        title: true,
        coverUrl: true,
        gameType: true,
        steamAppId: true,
        igdbRating: true,
        steamScore: true,
        releaseDate: true,
        // What the user already marked, so the frontend can show it
        playedBy: {
          where: { userId: current.sub },
          select: { status: true, playedAt: true },
        },
        // Whether the user already reviewed it (fills the review shortcut)
        reviews: {
          where: { userId: current.sub },
          select: { id: true },
          take: 1,
        },
      },
    });

    const matched = games
      .map(({ playedBy, reviews, ...game }) => ({
        ...game,
        playtimeMinutes: byAppId.get(game.steamAppId!)?.playtime_forever ?? 0,
        playedStatus: playedBy[0]?.status ?? null,
        reviewed: reviews.length > 0,
      }))
      .sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);

    return {
      private: false,
      totalOwned: owned.length,
      matched,
      unmatchedCount: owned.length - matched.length,
    };
  }

  // Steam friends who already have a Saveboxd account and aren't already
  // friends (or pending) with the current user.
  @Get('friends/suggestions')
  async friendSuggestions(@CurrentUser() current: JwtPayload) {
    const steamId = await this.requireSteamId(current.sub);

    const friendIds = await this.webApi.getFriendIds(steamId);
    if (friendIds === null) return { private: true, suggestions: [] };
    if (friendIds.length === 0) return { private: false, suggestions: [] };

    const candidates = await this.prisma.user.findMany({
      where: { steamId: { in: friendIds }, id: { not: current.sub } },
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
      suggestions: candidates.filter((c) => !linked.has(c.id)).map(toPublicUser),
    };
  }
}
