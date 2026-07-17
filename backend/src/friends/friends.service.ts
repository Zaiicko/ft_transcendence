import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FriendshipStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
