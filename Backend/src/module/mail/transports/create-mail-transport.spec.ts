import { createMailTransport } from './create-mail-transport';
import { ResendTransport } from './resend.transport';
import { SmtpTransport } from './smtp.transport';

describe('createMailTransport', () => {
  const originalProvider = process.env.MAIL_PROVIDER;
  const originalApiKey = process.env.RESEND_API_KEY;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.MAIL_PROVIDER;
    else process.env.MAIL_PROVIDER = originalProvider;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
  });

  it('defaults to SmtpTransport when MAIL_PROVIDER is unset', () => {
    delete process.env.MAIL_PROVIDER;

    expect(createMailTransport()).toBeInstanceOf(SmtpTransport);
  });

  it('returns SmtpTransport for MAIL_PROVIDER=smtp', () => {
    process.env.MAIL_PROVIDER = 'smtp';

    expect(createMailTransport()).toBeInstanceOf(SmtpTransport);
  });

  it('returns ResendTransport for MAIL_PROVIDER=resend', () => {
    process.env.MAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key';

    expect(createMailTransport()).toBeInstanceOf(ResendTransport);
  });

  it('is case-insensitive for the provider value', () => {
    process.env.MAIL_PROVIDER = 'RESEND';
    process.env.RESEND_API_KEY = 're_test_key';

    expect(createMailTransport()).toBeInstanceOf(ResendTransport);
  });

  it('throws on an unknown provider so a typo fails fast at boot', () => {
    process.env.MAIL_PROVIDER = 'sendgrid';

    expect(() => createMailTransport()).toThrow(
      'Unknown MAIL_PROVIDER "sendgrid"',
    );
  });

  it('throws when resend is selected without an API key', () => {
    process.env.MAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = '';

    expect(() => createMailTransport()).toThrow(
      'MAIL_PROVIDER=resend requires RESEND_API_KEY',
    );
  });
});
