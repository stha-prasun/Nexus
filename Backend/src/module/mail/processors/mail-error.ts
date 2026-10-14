import { UnrecoverableError } from 'bullmq';
import { MailTransportError } from '../transports/mail-transport';

/**
 * Classify a mail failure for BullMQ. Transports label permanent failures
 * (5xx SMTP, Resend validation/quota errors) via MailTransportError.permanent
 * → UnrecoverableError (stop immediately, no retry storm); everything else —
 * timeouts, 4xx, connection drops, rate limits — stays retryable with
 * exponential backoff.
 */
export const classifyMailError = (error: unknown): Error => {
  if (error instanceof MailTransportError) {
    if (error.permanent) {
      return new UnrecoverableError(`permanent mail failure: ${error.message}`);
    }
    return error;
  }
  return error instanceof Error ? error : new Error(String(error));
};
