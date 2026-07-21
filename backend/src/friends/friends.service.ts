import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthProvider, FriendshipStatus, User } from '@prisma/client';
import { ChatGateway } from '../chat/chat.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { SteamWebApiService } from '../steam/steam-web-api.service';
import { UsersService } from '../users/users.service';

const SUGGESTION_LIMIT = 20;

export interface FriendSuggestion {
  user: User;
  via: 'steam' | '42';
}

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly steamWebApi: SteamWebApiService,
    private readonly chatGateway: ChatGateway,
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
    return created;
  }

  // Temps réel : prévient les users concernés qu'un lien d'amitié a changé
  // (demande / acceptation / refus / suppression) → refetch côté profil, page
  // Friends et widget de chat. Room "user:<id>" partagée (cf. ChatGateway).
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
    // Les deux côtés voient l'amitié + la nouvelle conversation sans refresh
    this.notifyFriendUpdate(request.requesterId, request.addresseeId);
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
    // La conversation + les états d'amitié disparaissent des deux côtés en direct
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

  // People you may know, excluding yourself and anyone you already have a
  // friendship or pending request with (in either direction). Two sources:
  // your Steam friends who are on Saveboxd (if your Steam is linked), and —
  // when you signed in with 42 — other 42-authenticated users.
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
