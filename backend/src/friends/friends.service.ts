import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthProvider, FriendshipStatus, User } from '@prisma/client';
import { AchievementsService } from '../achievements/achievements.service';
import { ChatGateway } from '../chat/chat.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PsnApiService } from '../psn/psn-api.service';
import { SteamWebApiService } from '../steam/steam-web-api.service';
import { UsersService } from '../users/users.service';

const SUGGESTION_LIMIT = 20;

export interface FriendSuggestion {
  user: User;
  via: 'steam' | '42' | 'psn';
}

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly steamWebApi: SteamWebApiService,
    private readonly psnApi: PsnApiService,
    private readonly chatGateway: ChatGateway,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => AchievementsService))
    private readonly achievements: AchievementsService,
  ) {}

  async sendRequestByUsername(requesterId: number, username: string) {
    const target = await this.users.findByUsername(username);
    if (!target) throw new NotFoundException('User not found');
    return this.sendRequest(requesterId, target.id);
  }

  async sendRequest(requesterId: number, addresseeId: number) {
    if (requesterId === addresseeId) {
      throw new BadRequestException('You cannot friend yourself');
    }
    const addressee = await this.prisma.user.findUnique({ where: { id: addresseeId } });
    if (!addressee) throw new NotFoundException('User not found');

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });
    if (existing) {
      throw new BadRequestException('A friend request already exists between these users');
    }
    const created = await this.prisma.friendship.create({ data: { requesterId, addresseeId } });
    this.notifyFriendUpdate(requesterId, addresseeId);
    await this.notifications.friendRequested(requesterId, addresseeId);
    return created;
  }

  // Real-time: tells the users involved that a friendship changed (request,
  // accept, decline, removal) so the profile, Friends page and chat widget
  // refetch. Shares the "user:<id>" room with ChatGateway.
  private notifyFriendUpdate(...userIds: number[]) {
    for (const id of userIds) this.chatGateway.emitToUser(id, 'friend:update', {});
  }

  async accept(requestId: number, currentUserId: number) {
    const request = await this.prisma.friendship.findUnique({ where: { id: requestId } });
    if (!request || request.status !== FriendshipStatus.PENDING) throw new NotFoundException();
    if (request.addresseeId !== currentUserId) throw new ForbiddenException();

    const updated = await this.prisma.friendship.update({
      where: { id: requestId },
      data: { status: FriendshipStatus.ACCEPTED },
    });
    // Both sides see the friendship and the new conversation without a refresh
    this.notifyFriendUpdate(request.requesterId, request.addresseeId);
    // The requester is told their request was accepted
    await this.notifications.friendAccepted(request.addresseeId, request.requesterId);
    // "Friends" achievements: both gained one
    void this.achievements.evaluate(request.requesterId, ['friends']);
    void this.achievements.evaluate(request.addresseeId, ['friends']);
    return updated;
  }

  // Decline an incoming request or cancel one you sent — same operation, ownership-checked either side
  async removeRequest(requestId: number, currentUserId: number): Promise<void> {
    const request = await this.prisma.friendship.findUnique({ where: { id: requestId } });
    if (!request || request.status !== FriendshipStatus.PENDING) throw new NotFoundException();
    if (request.requesterId !== currentUserId && request.addresseeId !== currentUserId) {
      throw new ForbiddenException();
    }
    await this.prisma.friendship.delete({ where: { id: requestId } });
    this.notifyFriendUpdate(request.requesterId, request.addresseeId);
  }

  async unfriend(currentUserId: number, friendUserId: number): Promise<void> {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: currentUserId, addresseeId: friendUserId },
          { requesterId: friendUserId, addresseeId: currentUserId },
        ],
      },
    });
    if (!friendship) throw new NotFoundException();
    await this.prisma.friendship.delete({ where: { id: friendship.id } });
    // Conversation and friendship state vanish on both sides, live
    this.notifyFriendUpdate(currentUserId, friendUserId);
  }

  async listFriends(userId: number) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      include: { requester: true, addressee: true },
    });
    return friendships.map((f) => (f.requesterId === userId ? f.addressee : f.requester));
  }

  async listRequests(userId: number) {
    const [incoming, outgoing] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { addresseeId: userId, status: FriendshipStatus.PENDING },
        include: { requester: true },
      }),
      this.prisma.friendship.findMany({
        where: { requesterId: userId, status: FriendshipStatus.PENDING },
        include: { addressee: true },
      }),
    ]);
    return { incoming, outgoing };
  }

  // On signup, tells the new user's existing contacts that "X joined" — Steam
  // friends via the Steam list, 42 classmates via the provider. Steam wins on
  // a tie (personal link over school). Best-effort.
  async notifyContactJoined(newUserId: number): Promise<void> {
    try {
      const nu = await this.prisma.user.findUnique({
        where: { id: newUserId },
        select: { steamId: true, provider: true },
      });
      if (!nu) return;

      const steamRecipients = new Set<number>();
      if (nu.steamId) {
        try {
          const friendSteamIds = await this.steamWebApi.getFriendIds(nu.steamId);
          if (friendSteamIds && friendSteamIds.length > 0) {
            const users = await this.prisma.user.findMany({
              where: { steamId: { in: friendSteamIds }, id: { not: newUserId } },
              select: { id: true },
            });
            for (const u of users) steamRecipients.add(u.id);
          }
        } catch {
          // No STEAM_API_KEY or Steam unreachable: skip the Steam contacts
        }
      }

      const fortytwoRecipients = new Set<number>();
      if (nu.provider === AuthProvider.FORTYTWO) {
        const users = await this.prisma.user.findMany({
          where: { provider: AuthProvider.FORTYTWO, id: { not: newUserId } },
          select: { id: true },
        });
        for (const u of users) if (!steamRecipients.has(u.id)) fortytwoRecipients.add(u.id);
      }

      await Promise.all([
        ...[...steamRecipients].map((id) =>
          this.notifications.friendJoined(newUserId, id, 'steam'),
        ),
        ...[...fortytwoRecipients].map((id) =>
          this.notifications.friendJoined(newUserId, id, '42'),
        ),
      ]);
    } catch {
      // Never blocks the signup
    }
  }

  async suggestFriends(userId: number): Promise<FriendSuggestion[]> {
    const me = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!me) return [];

    const relations = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });

    const excludeIds = new Set<number>([userId]);
    for (const { requesterId, addresseeId } of relations) {
      excludeIds.add(requesterId);
      excludeIds.add(addresseeId);
    }

    // A user can match both sources; the Map keeps the Steam entry (a
    // personal connection beats a shared school).
    const suggestions = new Map<number, FriendSuggestion>();

    if (me.steamId) {
      try {
        const friendSteamIds = await this.steamWebApi.getFriendIds(me.steamId);
        if (friendSteamIds && friendSteamIds.length > 0) {
          const users = await this.prisma.user.findMany({
            where: { steamId: { in: friendSteamIds }, id: { notIn: [...excludeIds] } },
          });
          for (const user of users) suggestions.set(user.id, { user, via: 'steam' });
        }
      } catch {
        // No STEAM_API_KEY / Steam unreachable — skip Steam suggestions
      }
    }

    // PlayStation friends on Saveboxd when PSN is linked. Never overwrites an
    // existing Steam entry — personal link wins, as with Steam over 42.
    if (me.psnAccountId) {
      try {
        const friendAccountIds = await this.psnApi.getFriendAccountIds(me.psnAccountId);
        if (friendAccountIds && friendAccountIds.length > 0) {
          const users = await this.prisma.user.findMany({
            where: { psnAccountId: { in: friendAccountIds }, id: { notIn: [...excludeIds] } },
          });
          for (const user of users) {
            if (!suggestions.has(user.id)) suggestions.set(user.id, { user, via: 'psn' });
          }
        }
      } catch {
        // PSN session down or friend list private: skip the PSN suggestions
      }
    }

    if (me.provider === AuthProvider.FORTYTWO) {
      const users = await this.prisma.user.findMany({
        where: {
          provider: AuthProvider.FORTYTWO,
          id: { notIn: [...excludeIds, ...suggestions.keys()] },
        },
        take: SUGGESTION_LIMIT,
        orderBy: { createdAt: 'desc' },
      });
      for (const user of users) suggestions.set(user.id, { user, via: '42' });
    }

    return [...suggestions.values()].slice(0, SUGGESTION_LIMIT);
  }
}
