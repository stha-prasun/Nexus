import type { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';
import {
  type MailMessage,
  type MailTransport,
  MailTransportError,
} from './mail-transport';

const env = (key: string, fallback = ''): string =>
  process.env[key] ?? fallback;

/** Nodemailer SMTP backend — lazy transporter, same defaults as before. */
export class SmtpTransport implements MailTransport {
  readonly provider = 'smtp';
  private transporter: Transporter | null = null;

  async send(message: MailMessage): Promise<void> {
    try {
      await this.getTransporter().sendMail(message);
    } catch (error) {
      throw this.toTransportError(error);
    }
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

  /** SMTP 5xx = mailbox/permanent rejection; everything else is transient. */
  private toTransportError(error: unknown): MailTransportError {
    const code = (error as { responseCode?: unknown })?.responseCode;
    const permanent = typeof code === 'number' && code >= 500 && code < 600;
    const message = error instanceof Error ? error.message : String(error);
    return new MailTransportError(message, permanent, { cause: error });
  }
}
