import type { MailTransport } from './mail-transport';
import { ResendTransport } from './resend.transport';
import { SmtpTransport } from './smtp.transport';

const env = (key: string, fallback = ''): string =>
  process.env[key] ?? fallback;

/** Supported MAIL_PROVIDER values (the env-only switch). */
export const MAIL_PROVIDERS = ['smtp', 'resend'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

/**
 * Build the mail transport selected by MAIL_PROVIDER (default: smtp).
 * Throws on an unknown value so a typo fails fast at boot instead of
 * silently dropping email.
 */
export const createMailTransport = (): MailTransport => {
  const provider = env('MAIL_PROVIDER', 'smtp').toLowerCase();
  switch (provider) {
    case 'smtp':
      return new SmtpTransport();
    case 'resend':
      return new ResendTransport(env('RESEND_API_KEY'));
    default:
      throw new Error(
        `Unknown MAIL_PROVIDER "${provider}" — expected one of: ${MAIL_PROVIDERS.join(', ')}`,
      );
  }
};
