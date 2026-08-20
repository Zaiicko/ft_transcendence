import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  // Set so a human reading the notification (e.g. feedback.service.ts) can
  // just hit "reply" instead of copy-pasting an address out of the body.
  replyTo?: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    // ?? alone isn't enough: docker-compose passes `MAIL_FROM: ${MAIL_FROM}`,
    // which injects an *empty string* when the var is missing from .env — that
    // slips past ?? and makes nodemailer send a blank From, which SMTP relays
    // silently rewrite to the account's own login address and then reject.
    this.from = config.get<string>('MAIL_FROM')?.trim() || 'Saveboxd <no-reply@saveboxd.local>';
    this.logger.log(`Sending mail as ${this.from}`);
    const port = config.get<number>('SMTP_PORT') ?? 587;
    // Generic SMTP — works unmodified with SendGrid/Resend/Mailgun/Brevo/etc.
    // once the team fills in real credentials. Building the transporter never
    // throws even with empty host/auth; failures only surface at send time.
    this.transporter = createTransport({
      host: config.get<string>('SMTP_HOST'),
      port,
      // 465 = implicit TLS from the first byte; anything else (587, 25, ...)
      // negotiates TLS via STARTTLS instead — hardcoding false here broke
      // port 465 providers even though the common 587 case worked.
      secure: port === 465,
      auth: {
        user: config.get<string>('SMTP_USER'),
        pass: config.get<string>('SMTP_PASS'),
      },
      // Bounds worst-case latency when SMTP_HOST is unset/unreachable —
      // without this, an unconfigured or dead relay hangs the awaiting
      // signup/forgot-password request for nodemailer's default 2 minutes
      // before the catch below turns it into a harmless warning.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }

  // Best-effort: a broken/unconfigured mail relay must never fail the
  // request that triggered it (signup, forgot-password, ...). Success is
  // logged too (not just failure) — otherwise a working SMTP relay and a
  // silently-swallowed error look identical from the logs.
  async send(message: MailMessage): Promise<void> {
    try {
      const info = await this.transporter.sendMail({ from: this.from, ...message });
      this.logger.log(`Email sent to ${message.to} (messageId=${info.messageId})`);
    } catch (err) {
      this.logger.warn(`Failed to send email to ${message.to}: ${(err as Error).message}`);
    }
  }
}
