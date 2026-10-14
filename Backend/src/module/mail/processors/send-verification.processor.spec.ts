import { type Job, UnrecoverableError } from 'bullmq';
import { AppLogger } from '../../../common/logger/logger';
import type { Database } from '../../database/interfaces/database.interfaces';
import type { MailService } from '../mail.service';
import { MailTransportError } from '../transports/mail-transport';
import { SendVerificationProcessor } from './send-verification.processor';

describe('SendVerificationProcessor', () => {
  let processor: SendVerificationProcessor;

  const redis = { get: jest.fn() };
  const selectResult = jest.fn();
  const db = {
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => selectResult()),
        })),
      })),
    })),
  };
  const mailService = { send: jest.fn() };
  const logger = {
    child: () => ({ error: jest.fn(), info: jest.fn() }),
  };

  const job = (userId: string) =>
    ({ data: { userId } }) as Job<{ userId: string }>;

  const userId = '00000000-0000-4000-8000-000000000005';
  const userRow = {
    id: userId,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    emailVerifiedAt: null as Date | null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new SendVerificationProcessor(
      redis as never,
      db as unknown as Database,
      mailService as unknown as MailService,
      logger as unknown as AppLogger,
    );
    mailService.send.mockResolvedValue(undefined);
  });

  it('sends the email when token and unverified user exist', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([userRow]);

    const result = await processor.process(job(userId));

    expect(result).toEqual({ status: 'sent' });
    expect(mailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ada@example.com',
        subject: expect.stringContaining('Confirm'),
        html: expect.stringContaining('verify-email?token=tok123'),
      }),
    );
  });

  it('skips when the token is gone (expired or already consumed)', async () => {
    redis.get.mockResolvedValue(null);

    const result = await processor.process(job(userId));

    expect(result).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
    expect(selectResult).not.toHaveBeenCalled();
  });

  it('skips when the user is missing', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([]);

    expect(await processor.process(job(userId))).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('skips when the user is already verified (verify-then-worker race)', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([
      { ...userRow, emailVerifiedAt: new Date() },
    ]);

    expect(await processor.process(job(userId))).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('throws a retryable error for transient SMTP failures (4xx)', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([userRow]);
    const transient = new MailTransportError('timeout', false);
    mailService.send.mockRejectedValue(transient);

    await expect(processor.process(job(userId))).rejects.toThrow('timeout');
  });

  it('throws UnrecoverableError for permanent SMTP failures (5xx)', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([userRow]);
    const permanent = new MailTransportError('no such user', true);
    mailService.send.mockRejectedValue(permanent);

    await expect(processor.process(job(userId))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('throws UnrecoverableError for permanent Resend failures', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([userRow]);
    const permanent = new MailTransportError(
      'Resend invalid_from_address: ...',
      true,
    );
    mailService.send.mockRejectedValue(permanent);

    await expect(processor.process(job(userId))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('keeps Resend rate-limit failures retryable', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([userRow]);
    const rateLimited = new MailTransportError(
      'Resend rate_limit_exceeded: ...',
      false,
    );
    mailService.send.mockRejectedValue(rateLimited);

    await expect(processor.process(job(userId))).rejects.toThrow(
      'rate_limit_exceeded',
    );
  });
});
