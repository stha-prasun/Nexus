import { Injectable } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';
import { AppLogger } from '../../common/logger/logger';

// Defaults are empty/local so the app boots without SMTP configured; the
// worker will fail jobs (and retry) until real credentials are provided.
const env = (key: string, fallback = ''): string =>
  process.env[key] ?? fallback;

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** SMTP send — used by queue processors; swappable (Resend, dev stub) in one file. */
@Injectable()
export class MailService {
  private readonly log: ReturnType<AppLogger['child']>;
  private readonly from: string;
  private transporter: Transporter | null = null;

  constructor(logger: AppLogger) {
    this.log = logger.child('mail');
    const fromName = env('MAIL_FROM_NAME', 'Nexus');
    this.from = `"${fromName}" <${env('MAIL_FROM_EMAIL', 'noreply@nexus.local')}>`;
  }

  async send(options: SendMailOptions): Promise<void> {
    await this.getTransporter().sendMail({
      from: this.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    this.log.info('mail sent', { to: options.to, subject: options.subject });
  }

  private getTransporter(): Transporter {
    if (this.transporter === null) {
      const user = env('MAIL_SMTP_USER');
      this.transporter = nodemailer.createTransport({
        host: env('MAIL_SMTP_HOST', 'localhost'),
        port: Number(env('MAIL_SMTP_PORT', '587')),
        secure: env('MAIL_SMTP_SECURE') === 'true',
        auth: user ? { user, pass: env('MAIL_SMTP_PASS') } : undefined,
      });
    }
    return this.transporter;
  }
}
