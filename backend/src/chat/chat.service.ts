import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FriendshipStatus, MessageType, Prisma } from '@prisma/client';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { SendMessageDto } from './dto/send-message.dto';

// Sélection commune : un message hydraté avec l'expéditeur + l'aperçu de la
// cible partagée (au plus une non-nulle selon `type`).
const messageInclude = {
  sender: { select: { id: true, username: true, avatarUrl: true } },
  game: { select: { id: true, title: true, coverUrl: true } },
  review: {
    select: {
      id: true,
      title: true,
      rating: true,
      game: { select: { id: true, title: true, coverUrl: true } },
      company: { select: { id: true, name: true, logoUrl: true } },
    },
  },
  sharedUser: { select: { id: true, username: true, avatarUrl: true } },
} satisfies Prisma.MessageInclude;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly gateway: ChatGateway,
  ) {}

  // Liste des conversations = amis, avec dernier message, non-lus et statut en
  // ligne. Trié : conversations avec activité d'abord (dernier message récent).
  async listConversations(userId: number) {
    const friendIds = await this.friendIds(userId);
    if (friendIds.length === 0) return [];

    const friends = await this.prisma.user.findMany({
      where: { id: { in: friendIds } },
      select: { id: true, username: true, avatarUrl: true },
    });

    const convos = await Promise.all(
      friends.map(async (friend) => {
        const [lastMessage, unread] = await Promise.all([
          this.prisma.message.findFirst({
            where: this.betweenFilter(userId, friend.id),
            orderBy: { createdAt: 'desc' },
            include: messageInclude,
          }),
          this.prisma.message.count({
            where: { senderId: friend.id, recipientId: userId, readAt: null },
          }),
        ]);
        return {
          friend: { ...friend, isOnline: this.presence.isOnline(friend.id) },
          lastMessage,
          unread,
        };
      }),
    );

    // Amis avec messages en premier (plus récent d'abord), puis le reste
    return convos.sort((a, b) => {
      const ta = a.lastMessage ? a.lastMessage.createdAt.getTime() : 0;
      const tb = b.lastMessage ? b.lastMessage.createdAt.getTime() : 0;
      return tb - ta;
    });
  }

  // Fil entre l'utilisateur et un ami (marque les messages reçus comme lus).
  async getThread(userId: number, otherId: number, page: number, limit: number) {
    await this.assertFriends(userId, otherId);
    const messages = await this.prisma.message.findMany({
      where: this.betweenFilter(userId, otherId),
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: messageInclude,
    });
    await this.markRead(userId, otherId);
    // Renvoyé en ordre chronologique (le plus ancien en haut)
    return messages.reverse();
  }

  async send(userId: number, dto: SendMessageDto) {
    if (dto.toUserId === userId) throw new BadRequestException('Cannot message yourself');
    await this.assertFriends(userId, dto.toUserId);
    const type = dto.type ?? MessageType.TEXT;
    const data = await this.buildMessageData(userId, dto, type);

    const message = await this.prisma.message.create({
      data,
      include: messageInclude,
    });
    // Temps réel : destinataire + autres onglets de l'expéditeur reçoivent le
    // message hydraté (mêmes données que le fil / la liste de conversations).
    this.gateway.emitToUser(dto.toUserId, 'chat:message', message);
    this.gateway.emitToUser(userId, 'chat:message', message);
    return message;
  }

  async markRead(userId: number, otherId: number) {
    const { count } = await this.prisma.message.updateMany({
      where: { senderId: otherId, recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    // Prévient l'expéditeur que ses messages ont été lus (accusé de lecture)
    if (count > 0) this.gateway.emitToUser(otherId, 'chat:read', { by: userId });
    return { ok: true };
  }

  async unreadCount(userId: number) {
    const count = await this.prisma.message.count({
      where: { recipientId: userId, readAt: null },
    });
    return { count };
  }

  // ---- helpers ----

  // Construit le `data` du message selon le type et valide la cohérence des refs
  private async buildMessageData(
    userId: number,
    dto: SendMessageDto,
    type: MessageType,
  ): Promise<Prisma.MessageCreateInput> {
    const base = {
      sender: { connect: { id: userId } },
      recipient: { connect: { id: dto.toUserId } },
      type,
      content: dto.content?.trim() || null,
    };

    if (type === MessageType.TEXT) {
      if (!base.content) throw new BadRequestException('Empty message');
      return base;
    }
    if (type === MessageType.GAME) {
      if (!dto.gameId) throw new BadRequestException('gameId required');
      await this.assertExists('game', dto.gameId);
      return { ...base, game: { connect: { id: dto.gameId } } };
    }
    if (type === MessageType.REVIEW) {
      if (!dto.reviewId) throw new BadRequestException('reviewId required');
      await this.assertExists('review', dto.reviewId);
      return { ...base, review: { connect: { id: dto.reviewId } } };
    }
    // PROFILE
    if (!dto.sharedUserId) throw new BadRequestException('sharedUserId required');
    await this.assertExists('user', dto.sharedUserId);
    return { ...base, sharedUser: { connect: { id: dto.sharedUserId } } };
  }

  private async assertExists(model: 'game' | 'review' | 'user', id: number) {
    const row = await (this.prisma[model] as { findUnique: (a: unknown) => Promise<unknown> })
      .findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException(`${model} not found`);
  }

  private betweenFilter(a: number, b: number): Prisma.MessageWhereInput {
    return {
      OR: [
        { senderId: a, recipientId: b },
        { senderId: b, recipientId: a },
      ],
    };
  }

  private async friendIds(userId: number): Promise<number[]> {
    const rows = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    });
    return rows.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));
  }

  private async assertFriends(userId: number, otherId: number) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: userId, addresseeId: otherId },
          { requesterId: otherId, addresseeId: userId },
        ],
      },
      select: { id: true },
    });
    if (!friendship) throw new ForbiddenException('You can only message friends');
  }
}
