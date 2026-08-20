import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeedbackStatus } from '@prisma/client';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

const publicAuthor = { select: { id: true, username: true, avatarUrl: true } };
const messagesOrdered = { orderBy: { createdAt: 'asc' as const } };

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

@Injectable()
export class FeedbackService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private config: ConfigService,
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

    await this.notifyAdmin(user?.username ?? null, user?.email ?? dto.email, dto.message, dto.url);

    return { id: feedback.id };
  }

  list(status: FeedbackStatus) {
    return this.prisma.feedback.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      include: { user: publicAuthor, messages: messagesOrdered },
    });
  }

  // The submitter's own tickets, most recent first — powers the "My
  // tickets" tab in the feedback bubble, where several can be open at once.
  myTickets(userId: number) {
    return this.prisma.feedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { messages: messagesOrdered },
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

  // Posts to the ticket's own thread — does NOT change status: only the
  // admin's explicit "mark resolved" button, or the user closing it
  // themselves, do that. A reply just means "there's an update to read".
  async reply(id: number, message: string) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    if (!feedback) throw new NotFoundException();
    await this.prisma.feedbackMessage.create({
      data: { feedbackId: id, fromAdmin: true, text: message },
    });
    return { ok: true };
  }

  // The ticket owner replying from their own thread — reopens it if it had
  // already been resolved, since a reply means they still need help.
  async replyAsOwner(userId: number, id: number, message: string) {
    const feedback = await this.assertOwner(userId, id);
    await this.prisma.feedbackMessage.create({
      data: { feedbackId: id, fromAdmin: false, text: message },
    });
    if (feedback.status === 'RESOLVED') {
      await this.prisma.feedback.update({ where: { id }, data: { status: 'OPEN' } });
    }
    return { ok: true };
  }

  // The user's own "close ticket" action — unlike an admin resolving it,
  // this deletes the ticket and its thread outright.
  async closeAsOwner(userId: number, id: number) {
    await this.assertOwner(userId, id);
    await this.prisma.feedback.delete({ where: { id } });
    return { ok: true };
  }

  private async assertOwner(userId: number, id: number) {
    const feedback = await this.prisma.feedback.findUnique({ where: { id } });
    // NotFoundException either way (not just Forbidden) — a non-owner
    // shouldn't be able to tell "not mine" from "doesn't exist".
    if (!feedback || feedback.userId !== userId) throw new NotFoundException();
    return feedback;
  }

  // Best-effort notification on top of the DB record — the admin panel is
  // the source of truth (works even if SMTP is unconfigured or down), this
  // is just so an admin doesn't have to keep the tab open.
  private async notifyAdmin(
    username: string | null,
    email: string | null | undefined,
    message: string,
    url: string | null | undefined,
  ) {
    const from = username ? `${username} <${email}>` : email ? email : 'anonymous';
    const html = `
      <p><strong>From:</strong> ${escapeHtml(from)}</p>
      ${url ? `<p><strong>Page:</strong> ${escapeHtml(url)}</p>` : ''}
      <p><strong>Message:</strong></p>
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    `;
    await this.mailer.send({
      to: this.config.get<string>('CONTACT_EMAIL')?.trim() || 'saveboxd.transcendence@gmail.com',
      subject: `Saveboxd feedback from ${username ?? 'a guest'}`,
      html,
      replyTo: email ?? undefined,
    });
  }
}
