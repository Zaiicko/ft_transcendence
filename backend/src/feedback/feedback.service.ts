import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '../mailer/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

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

    const from = user ? `${user.username} <${user.email}>` : dto.email ? dto.email : 'anonymous';
    const replyTo = user?.email ?? dto.email;

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
      replyTo,
    });

    return { ok: true };
  }
}
