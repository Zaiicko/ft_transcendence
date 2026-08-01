import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

// Instantané dénormalisé stocké dans payload Json : la notification reste
// lisible même si l'acteur ou la review disparaissent ensuite
type ReviewPayload = {
  actorId: number;
  actorUsername: string;
  actorAvatarUrl: string | null;
  reviewId: number;
  reviewTitle: string;
  gameId: number | null;
  companyId: number | null;
  commentId?: number;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  // Appelé par ReviewsService après un like — jamais bloquant pour l'action
  async reviewLiked(actorId: number, reviewId: number): Promise<void> {
    try {
      const review = await this.reviewFor(reviewId);
      if (!review || review.userId === null || review.userId === actorId) return;
      // Anti-spam du toggle like/unlike : une seule notification par
      // (destinataire, acteur, review), même déjà lue
      const existing = await this.prisma.notification.findFirst({
        where: {
          userId: review.userId,
          type: NotificationType.REVIEW_LIKE,
          AND: [
            { payload: { path: ['actorId'], equals: actorId } },
            { payload: { path: ['reviewId'], equals: reviewId } },
          ],
        },
        select: { id: true },
      });
      if (existing) return;
      await this.deliver(review.userId, NotificationType.REVIEW_LIKE, {
        ...(await this.reviewPayload(actorId, reviewId, review)),
      });
    } catch (err) {
      this.logger.warn(`reviewLiked notification failed: ${(err as Error).message}`);
    }
  }

  // Appelé par ReviewCommentsService après un commentaire ou une réponse
  async commentPosted(
    actorId: number,
    reviewId: number,
    commentId: number,
    parentId: number | null,
  ): Promise<void> {
    try {
      let recipientId: number | null;
      let type: NotificationType;
      if (parentId) {
        const parent = await this.prisma.reviewComment.findUnique({
          where: { id: parentId },
          select: { userId: true },
        });
        recipientId = parent?.userId ?? null; // null = tombale ou anonymisé
        type = NotificationType.COMMENT_REPLY;
      } else {
        const review = await this.reviewFor(reviewId);
        recipientId = review?.userId ?? null;
        type = NotificationType.REVIEW_COMMENT;
      }
      if (recipientId === null || recipientId === actorId) return;
      const review = await this.reviewFor(reviewId);
      if (!review) return;
      await this.deliver(recipientId, type, {
        ...(await this.reviewPayload(actorId, reviewId, review)),
        commentId,
      });
    } catch (err) {
      this.logger.warn(`commentPosted notification failed: ${(err as Error).message}`);
    }
  }

  list(userId: number, page: number, limit: number, unreadOnly: boolean) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly && { readAt: null }) },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async unreadCount(userId: number) {
    const count = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  async markRead(userId: number, id: number): Promise<void> {
    // updateMany filtré par userId : marquer la notification d'un autre = 404
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.prisma.notification.findFirst({ where: { id, userId } });
      if (!exists) throw new NotFoundException();
    }
  }

  async markAllRead(userId: number): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // Vide toutes les notifications de l'utilisateur (bouton « clear »).
  async clearAll(userId: number): Promise<void> {
    await this.prisma.notification.deleteMany({ where: { userId } });
  }

  private reviewFor(reviewId: number) {
    return this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { userId: true, title: true, gameId: true, companyId: true },
    });
  }

  private async reviewPayload(
    actorId: number,
    reviewId: number,
    review: { title: string; gameId: number | null; companyId: number | null },
  ): Promise<ReviewPayload> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { username: true, avatarUrl: true },
    });
    return {
      actorId,
      actorUsername: actor?.username ?? '[utilisateur supprimé]',
      actorAvatarUrl: actor?.avatarUrl ?? null,
      reviewId,
      reviewTitle: review.title,
      gameId: review.gameId,
      companyId: review.companyId,
    };
  }

  private async deliver(
    userId: number,
    type: NotificationType,
    payload: Record<string, unknown>,
  ) {
    // Respecte les préférences du destinataire (opt-out par type)
    if (!(await this.wants(userId, type))) return;
    const notification = await this.prisma.notification.create({
      data: { userId, type, payload: payload as Prisma.InputJsonValue },
    });
    this.gateway.emitToUser(userId, 'notification:new', notification);
  }

  // ---- Notifications d'amitié (appelées par FriendsService) ----

  async friendRequested(actorId: number, recipientId: number): Promise<void> {
    try {
      await this.deliver(recipientId, NotificationType.FRIEND_REQUEST, await this.actorPayload(actorId));
    } catch (err) {
      this.logger.warn(`friendRequested notification failed: ${(err as Error).message}`);
    }
  }

  async friendAccepted(actorId: number, recipientId: number): Promise<void> {
    try {
      await this.deliver(recipientId, NotificationType.FRIEND_ACCEPT, await this.actorPayload(actorId));
    } catch (err) {
      this.logger.warn(`friendAccepted notification failed: ${(err as Error).message}`);
    }
  }

  // Un contact (ami Steam / camarade 42) vient de s'inscrire
  async friendJoined(actorId: number, recipientId: number, via: 'steam' | '42'): Promise<void> {
    try {
      await this.deliver(recipientId, NotificationType.FRIEND_JOINED, {
        ...(await this.actorPayload(actorId)),
        via,
      });
    } catch (err) {
      this.logger.warn(`friendJoined notification failed: ${(err as Error).message}`);
    }
  }

  // Succès « maison » débloqué par l'utilisateur lui-même (auto-notification).
  async achievementUnlocked(userId: number, key: string): Promise<void> {
    try {
      await this.deliver(userId, NotificationType.ACHIEVEMENT, { achievementKey: key });
    } catch (err) {
      this.logger.warn(`achievementUnlocked notification failed: ${(err as Error).message}`);
    }
  }

  private async actorPayload(actorId: number) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { username: true, avatarUrl: true },
    });
    return {
      actorId,
      actorUsername: actor?.username ?? '[utilisateur supprimé]',
      actorAvatarUrl: actor?.avatarUrl ?? null,
    };
  }

  // ---- Préférences (opt-out par type) ----

  // Types que l'utilisateur peut activer/désactiver (NEW_MESSAGE géré par le chat)
  static readonly CUSTOMIZABLE: NotificationType[] = [
    NotificationType.FRIEND_REQUEST,
    NotificationType.FRIEND_ACCEPT,
    NotificationType.REVIEW_LIKE,
    NotificationType.REVIEW_COMMENT,
    NotificationType.COMMENT_REPLY,
    NotificationType.FRIEND_JOINED,
    NotificationType.ACHIEVEMENT,
  ];

  private async wants(userId: number, type: NotificationType): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });
    const prefs = (user?.notificationPrefs ?? {}) as Record<string, boolean>;
    return prefs[type] !== false; // absent/true = activé
  }

  // Renvoie l'état (activé/désactivé) de chaque type personnalisable
  async getPreferences(userId: number): Promise<Record<string, boolean>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });
    const prefs = (user?.notificationPrefs ?? {}) as Record<string, boolean>;
    return Object.fromEntries(
      NotificationsService.CUSTOMIZABLE.map((t) => [t, prefs[t] !== false]),
    );
  }

  // Fusionne des changements (uniquement des types connus) dans les prefs
  async updatePreferences(
    userId: number,
    changes: Record<string, boolean>,
  ): Promise<Record<string, boolean>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPrefs: true },
    });
    const prefs = { ...((user?.notificationPrefs ?? {}) as Record<string, boolean>) };
    for (const [key, value] of Object.entries(changes)) {
      if ((NotificationsService.CUSTOMIZABLE as string[]).includes(key)) prefs[key] = value;
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { notificationPrefs: prefs as Prisma.InputJsonValue },
    });
    return this.getPreferences(userId);
  }
}
