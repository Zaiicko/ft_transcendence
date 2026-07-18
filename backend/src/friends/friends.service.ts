import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthProvider, FriendshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

const SUGGESTION_LIMIT = 20;

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
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
    return this.prisma.friendship.create({ data: { requesterId, addresseeId } });
  }

  async accept(requestId: number, currentUserId: number) {
    const request = await this.prisma.friendship.findUnique({ where: { id: requestId } });
    if (!request || request.status !== FriendshipStatus.PENDING) throw new NotFoundException();
    if (request.addresseeId !== currentUserId) throw new ForbiddenException();

    return this.prisma.friendship.update({
      where: { id: requestId },
      data: { status: FriendshipStatus.ACCEPTED },
    });
  }

  // Decline an incoming request or cancel one you sent — same operation, ownership-checked either side
  async removeRequest(requestId: number, currentUserId: number): Promise<void> {
    const request = await this.prisma.friendship.findUnique({ where: { id: requestId } });
    if (!request || request.status !== FriendshipStatus.PENDING) throw new NotFoundException();
    if (request.requesterId !== currentUserId && request.addresseeId !== currentUserId) {
      throw new ForbiddenException();
    }
    await this.prisma.friendship.delete({ where: { id: requestId } });
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

  // Other 42-authenticated users, excluding yourself and anyone you already
  // have a friendship or pending request with (in either direction).
  async suggestFortyTwoFriends(userId: number) {
    const relations = await this.prisma.friendship.findMany({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }] },
      select: { requesterId: true, addresseeId: true },
    });

    const excludeIds = new Set<number>([userId]);
    for (const { requesterId, addresseeId } of relations) {
      excludeIds.add(requesterId);
      excludeIds.add(addresseeId);
    }

    return this.prisma.user.findMany({
      where: { provider: AuthProvider.FORTYTWO, id: { notIn: [...excludeIds] } },
      take: SUGGESTION_LIMIT,
      orderBy: { createdAt: 'desc' },
    });
  }
}
