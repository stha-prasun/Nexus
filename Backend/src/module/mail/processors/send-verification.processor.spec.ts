import { type Job, UnrecoverableError } from 'bullmq';
import { AppLogger } from '../../../common/logger/logger';
import type { Database } from '../../database/interfaces/database.interfaces';
import type { MailService } from '../mail.service';
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

  const job = (userId: number) =>
    ({ data: { userId } }) as Job<{ userId: number }>;

  const userRow = {
    id: 5,
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

    const result = await processor.process(job(5));

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

    const result = await processor.process(job(5));

    expect(result).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
    expect(selectResult).not.toHaveBeenCalled();
  });

  it('skips when the user is missing', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([]);

    expect(await processor.process(job(5))).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('skips when the user is already verified (verify-then-worker race)', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([
      { ...userRow, emailVerifiedAt: new Date() },
    ]);

    expect(await processor.process(job(5))).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
  });

  it('throws a retryable error for transient SMTP failures (4xx)', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([userRow]);
    const transient = Object.assign(new Error('timeout'), {
      responseCode: 451,
    });
    mailService.send.mockRejectedValue(transient);

    await expect(processor.process(job(5))).rejects.toThrow('timeout');
  });

  it('throws UnrecoverableError for permanent SMTP failures (5xx)', async () => {
    redis.get.mockResolvedValue('tok123');
    selectResult.mockResolvedValue([userRow]);
    const permanent = Object.assign(new Error('no such user'), {
      responseCode: 550,
    });
    mailService.send.mockRejectedValue(permanent);

    await expect(processor.process(job(5))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
