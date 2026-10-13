import { UnrecoverableError } from 'bullmq';

const responseCodeOf = (error: unknown): number | undefined => {
  const code = (error as { responseCode?: unknown })?.responseCode;
  return typeof code === 'number' ? code : undefined;
};

/**
 * Classify an SMTP failure for BullMQ: 5xx is permanent (UnrecoverableError —
 * stop immediately, no retry storm); 4xx and connection/timeouts stay
 * retryable with exponential backoff.
 */
export const classifySmtpError = (error: unknown): Error => {
  const code = responseCodeOf(error);
  if (code !== undefined && code >= 500 && code < 600) {
    const message = error instanceof Error ? error.message : String(error);
    return new UnrecoverableError(
      `permanent SMTP failure (${code}): ${message}`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
};
