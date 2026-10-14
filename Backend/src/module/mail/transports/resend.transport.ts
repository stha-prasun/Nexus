import { Resend } from 'resend';
import {
  type MailMessage,
  type MailTransport,
  MailTransportError,
} from './mail-transport';

// Transient Resend failures worth retrying: rate limits and Resend-side
// outages. Quota exhaustion is treated as permanent — 5 exponential retries
// will not free up monthly/daily quota.
const RETRYABLE_NAMES = new Set([
  'rate_limit_exceeded',
  'internal_server_error',
]);

/** Resend API backend (https://resend.com) — requires RESEND_API_KEY. */
export class ResendTransport implements MailTransport {
  readonly provider = 'resend';
  private readonly client: Resend;

  constructor(apiKey: string) {
    if (apiKey === '') {
      throw new Error('MAIL_PROVIDER=resend requires RESEND_API_KEY to be set');
    }
    this.client = new Resend(apiKey);
  }

  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (error !== null) {
      throw new MailTransportError(
        `Resend ${error.name}: ${error.message}`,
        !RETRYABLE_NAMES.has(error.name),
        { cause: error },
      );
    }
  }
}
