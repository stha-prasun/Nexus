import { AppLogger } from '../../common/logger/logger';
import { MailService } from './mail.service';
import type { MailTransport } from './transports/mail-transport';

describe('MailService', () => {
  const logger = {
    child: () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }),
  };
  const transport = {
    provider: 'smtp',
    send: jest.fn(),
  };

  const originalEnv = {
    MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
    MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL,
  };

  let service: MailService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MAIL_FROM_NAME = 'Nexus';
    process.env.MAIL_FROM_EMAIL = 'noreply@example.com';
    service = new MailService(
      transport as unknown as MailTransport,
      logger as unknown as AppLogger,
    );
    transport.send.mockResolvedValue(undefined);
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('sends through the injected transport with a formatted from header', async () => {
    await service.send({
      to: 'ada@example.com',
      subject: 'Confirm',
      text: 'plain',
      html: '<p>plain</p>',
    });

    expect(transport.send).toHaveBeenCalledWith({
      from: '"Nexus" <noreply@example.com>',
      to: 'ada@example.com',
      subject: 'Confirm',
      text: 'plain',
      html: '<p>plain</p>',
    });
  });

  it('propagates transport errors (classified later by processors)', async () => {
    transport.send.mockRejectedValue(new Error('boom'));

    await expect(
      service.send({
        to: 'ada@example.com',
        subject: 'x',
        text: 'x',
        html: 'x',
      }),
    ).rejects.toThrow('boom');
  });
});
