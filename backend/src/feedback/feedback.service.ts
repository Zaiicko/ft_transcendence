import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedbackStatus, FriendshipStatus } from '@prisma/client';
import { ChatService } from '../chat/chat.service';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

@Injectable()
export class FeedbackService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
    private chat: ChatService,
  ) {}

  async create(userId: number | undefined, dto: CreateFeedbackDto) {
    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { username: true, email: true } })
      : null;

    const feedback = await this.prisma.feedback.create({
      data: {
        userId: userId ?? null,
        email: user?.email ?? dto.email,
        message: dto.message,
        url: dto.url,
      },
    });

    // Best-effort notification on top of the DB record above — the admin
    // panel is the source of truth (works even if SMTP is unconfigured or
    // down), this is just so an admin doesn't have to keep the tab open.
    const from = user ? `${user.username} <${user.email}>` : dto.email ? dto.email : 'anonymous';
    const html = `
      <p><strong>From:</strong> ${escapeHtml(from)}</p>
      ${dto.url ? `<p><strong>Page:</strong> ${escapeHtml(dto.url)}</p>` : ''}
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(dto.message).replace(/\n/g, '<br>')}</p>
    `;
    await this.mailer.send({
      to: this.config.get<string>('CONTACT_EMAIL')?.trim() || 'saveboxd.transcendence@gmail.com',
      subject: `Saveboxd feedback from ${user?.username ?? 'a guest'}`,
      html,
      replyTo: user?.email ?? dto.email,
    });

    return { id: feedback.id };
  }

  list(status: FeedbackStatus) {
    return this.prisma.feedback.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      include: { user: publicAuthor },
    });
  }

  async resolve(adminId: number, id: number) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    if (!feedback) throw new NotFoundException();
    if (feedback.status !== 'OPEN') throw new ForbiddenException('Already resolved');
    await this.prisma.feedback.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedById: adminId, resolvedAt: new Date() },
    });
    return { ok: true };
  }

  // Delivers the reply as a normal DM from the admin's own account — chat is
  // friends-only (ChatService.assertFriends), so a submitter who isn't
  // already friends with the admin is silently connected first. That's the
  // only way for the message to actually reach their inbox given the
  // existing chat model (conversations are built from the friend list, not
  // from message history), and it doubles as a legitimate support channel:
  // the user can reply back through normal chat afterwards.
  async reply(adminId: number, id: number, message: string) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    if (!feedback) throw new NotFoundException();
    if (!feedback.userId) {
      throw new ForbiddenException('This feedback was submitted without an account — reply by email instead');
    }

    const existing = await this.prisma.friendship.findFirst({
      where: {
        status: FriendshipStatus.ACCEPTED,
        OR: [
          { requesterId: adminId, addresseeId: feedback.userId },
          { requesterId: feedback.userId, addresseeId: adminId },
        ],
      },
      select: { id: true },
    });
    if (!existing) {
      await this.prisma.friendship.create({
        data: { requesterId: adminId, addresseeId: feedback.userId, status: FriendshipStatus.ACCEPTED },
      });
    }

    await this.chat.send(adminId, { toUserId: feedback.userId, content: message });

    if (feedback.status === 'OPEN') {
      await this.prisma.feedback.update({
        where: { id },
        data: { status: 'RESOLVED', resolvedById: adminId, resolvedAt: new Date() },
      });
    }

    return { ok: true };
  }
}
