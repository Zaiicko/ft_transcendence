import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM') ?? 'Saveboxd <no-reply@saveboxd.local>';
    // Generic SMTP — works unmodified with SendGrid/Resend/Mailgun/etc. once
    // the team fills in real credentials. Building the transporter never
    // throws even with empty host/auth; failures only surface at send time.
    this.transporter = createTransport({
      host: config.get<string>('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT') ?? 587,
      secure: false,
      auth: {
        user: config.get<string>('SMTP_USER'),
        pass: config.get<string>('SMTP_PASS'),
      },
    });
  }

  // Best-effort: a broken/unconfigured mail relay must never fail the
  // request that triggered it (signup, forgot-password, ...).
  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (err) {
      this.logger.warn(`Failed to send email to ${message.to}: ${(err as Error).message}`);
    }
  }
}
