import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from '../../common/logger/logger';
import { MAIL_TRANSPORT } from './constants/mail.constants';
import type { MailTransport } from './transports/mail-transport';

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

/**
 * Provider-agnostic send — used by queue processors. The concrete backend
 * (SMTP via nodemailer, Resend, …) is chosen by MAIL_PROVIDER in .env and
 * built once by createMailTransport(); no code change needed to switch.
 */
@Injectable()
export class MailService {
  private readonly log: ReturnType<AppLogger['child']>;
  private readonly from: string;

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    logger: AppLogger,
  ) {
    this.log = logger.child('mail');
    const fromName = env('MAIL_FROM_NAME', 'Nexus');
    this.from = `"${fromName}" <${env('MAIL_FROM_EMAIL', 'noreply@nexus.local')}>`;
  }

  async send(options: SendMailOptions): Promise<void> {
    await this.transport.send({
      from: this.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
    this.log.info('mail sent', {
      to: options.to,
      subject: options.subject,
      provider: this.transport.provider,
    });
  }
}
