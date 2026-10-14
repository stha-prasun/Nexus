import { Resend } from 'resend';
import { MailTransportError } from './mail-transport';
import { ResendTransport } from './resend.transport';

jest.mock('resend', () => ({
  Resend: jest.fn(),
}));

const sendMock = jest.fn();

describe('ResendTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Resend as unknown as jest.Mock).mockImplementation(() => ({
      emails: { send: sendMock },
    }));
  });

  const message = {
    from: '"Nexus" <noreply@example.com>',
    to: 'ada@example.com',
    subject: 'Hi',
    text: 'Hi',
    html: '<p>Hi</p>',
  };

  it('throws when constructed without an API key', () => {
    expect(() => new ResendTransport('')).toThrow(
      'MAIL_PROVIDER=resend requires RESEND_API_KEY',
    );
  });

  it('passes the message through to the Resend API', async () => {
    sendMock.mockResolvedValue({ data: { id: 'abc' }, error: null });
    const transport = new ResendTransport('re_test');

    await transport.send(message);

    expect(sendMock).toHaveBeenCalledWith({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it('marks rate_limit_exceeded as retryable', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'rate_limit_exceeded',
        message: 'rate limit hit',
        statusCode: 429,
      },
    });
    const transport = new ResendTransport('re_test');

    const error = await transport.send(message).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MailTransportError);
    expect((error as MailTransportError).permanent).toBe(false);
  });

  it('marks validation failures as permanent', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'invalid_from_address',
        message: 'bad from',
        statusCode: 403,
      },
    });
    const transport = new ResendTransport('re_test');

    const error = await transport.send(message).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MailTransportError);
    expect((error as MailTransportError).permanent).toBe(true);
  });

  it('marks quota exhaustion as permanent', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: {
        name: 'monthly_quota_exceeded',
        message: 'quota',
        statusCode: 429,
      },
    });
    const transport = new ResendTransport('re_test');

    const error = await transport.send(message).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MailTransportError);
    expect((error as MailTransportError).permanent).toBe(true);
  });
});
