import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedbackStatus, Prisma } from '@prisma/client';
import { ChatService } from '../chat/chat.service';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };

// Reserved system account that delivers feedback replies — never a real
// login (no password, LOCAL provider). Fixed, well-known identity so a
// second reply doesn't create a second bot.
const ADMIN_BOT_EMAIL = 'admin-bot@saveboxd.internal';
const ADMIN_BOT_USERNAME = 'Admin';

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

  // Delivers the reply as a DM from the reserved "Admin" bot account, not
  // the real admin's personal one — the user explicitly didn't want a
  // stranger's feedback reply adding them as a friend of their own account.
  // ChatService lets a system account message anyone without a Friendship
  // row (see assertFriends/systemContactIds), so no friend-adding happens
  // at all, on either account.
  async reply(adminId: number, id: number, message: string) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    if (!feedback) throw new NotFoundException();
    if (!feedback.userId) {
      throw new ForbiddenException('This feedback was submitted without an account — reply by email instead');
    }

    const botId = await this.getOrCreateAdminBot();
    await this.chat.send(botId, { toUserId: feedback.userId, content: message });

    if (feedback.status === 'OPEN') {
      await this.prisma.feedback.update({
        where: { id },
        data: { status: 'RESOLVED', resolvedById: adminId, resolvedAt: new Date() },
      });
    }

    return { ok: true };
  }

  // Ticket-system behaviour: the user's OWN latest ticket, whichever status
  // it's in. Both reopen (a chat reply) and close (the user's own button)
  // act on this — a user only ever has one active thread with the bot, so
  // there's no ambiguity about which ticket a reply belongs to.
  private latestForUser(userId: number) {
    return this.prisma.feedback.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
  }

  // Called by ChatService when the user messages the Admin bot — if their
  // latest ticket was already resolved, a reply means they need more help,
  // so it goes back on the admin's Open queue. Already-open is a no-op.
  async reopenLatestForUser(userId: number) {
    const latest = await this.latestForUser(userId);
    if (latest && latest.status === 'RESOLVED') {
      await this.prisma.feedback.update({
        where: { id: latest.id },
        data: { status: 'OPEN', resolvedById: null, resolvedAt: null },
      });
    }
  }

  // The user's own "close ticket" action (from their chat thread with the
  // bot) — same effect as an admin resolving it, just attributed to the
  // user themselves. A no-op if there's no ticket or it's already resolved.
  async closeLatestForUser(userId: number) {
    const latest = await this.latestForUser(userId);
    if (latest && latest.status === 'OPEN') {
      await this.prisma.feedback.update({
        where: { id: latest.id },
        data: { status: 'RESOLVED', resolvedById: userId, resolvedAt: new Date() },
      });
    }
    return { ok: true };
  }

  private async getOrCreateAdminBot(): Promise<number> {
    const existing = await this.prisma.user.findFirst({
      where: { isSystemAccount: true },
      select: { id: true },
    });
    if (existing) return existing.id;

    try {
      const bot = await this.prisma.user.create({
        data: {
          email: ADMIN_BOT_EMAIL,
          username: ADMIN_BOT_USERNAME,
          usernameLower: ADMIN_BOT_USERNAME.toLowerCase(),
          provider: 'LOCAL',
          isSystemAccount: true,
        },
      });
      return bot.id;
    } catch (e) {
      // Two replies racing to create the bot: the loser just re-reads it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const bot = await this.prisma.user.findFirst({
          where: { isSystemAccount: true },
          select: { id: true },
        });
        if (bot) return bot.id;
      }
      throw e;
    }
  }
}
