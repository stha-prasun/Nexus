/** Normalized message passed to any mail transport. */
export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * A mail provider backend (nodemailer/SMTP, Resend, …). Implementations
 * throw MailTransportError for provider failures so BullMQ classification
 * is provider-agnostic.
 */
export interface MailTransport {
  readonly provider: string;
  send(message: MailMessage): Promise<void>;
}

/**
 * Provider failure with an explicit permanence flag: permanent errors
 * (invalid address, rejected sender, quota exhausted) stop BullMQ retries;
 * transient ones (timeouts, 4xx, rate limits) back off and retry.
 */
export class MailTransportError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'MailTransportError';
  }
}
