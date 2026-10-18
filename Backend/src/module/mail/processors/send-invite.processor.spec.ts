import { type Job, UnrecoverableError } from 'bullmq';
import { AppLogger } from '../../../common/logger/logger';
import type { Database } from '../../database/interfaces/database.interfaces';
import type { MailService } from '../mail.service';
import { MailTransportError } from '../transports/mail-transport';
import { SendInviteProcessor } from './send-invite.processor';

describe('SendInviteProcessor', () => {
  let processor: SendInviteProcessor;

  const membershipId = '00000000-0000-4000-8000-000000000010';
  const token = 'a'.repeat(64);

  const limit = jest.fn();
  const where = jest.fn(() => ({ limit }));
  const leftJoin = jest.fn(() => ({ where }));
  const innerJoin = jest.fn(() => ({ leftJoin }));
  const from = jest.fn(() => ({ innerJoin }));
  const db = { select: jest.fn(() => ({ from })) };
  const redis = { get: jest.fn() };
  const mailService = { send: jest.fn() };
  const log = { error: jest.fn(), info: jest.fn() };
  const logger = { child: () => log };

  const job = () =>
    ({ data: { membershipId } }) as Job<{ membershipId: string }>;

  const invitedRow = {
    status: 'INVITED' as const,
    invitedRole: 'HR',
    // Invite identity — membership email, NOT a joined users row. This is
    // the accountless-invitee case (user_id NULL) that used to be skipped.
    email: 'invitee@example.com',
    orgName: 'Acme',
    inviterName: 'Ada Lovelace',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new SendInviteProcessor(
      redis as never,
      db as unknown as Database,
      mailService as unknown as MailService,
      logger as unknown as AppLogger,
    );
    mailService.send.mockResolvedValue(undefined);
  });

  it('sends to the membership email even when no account exists (user_id NULL)', async () => {
    redis.get.mockResolvedValue(token);
    limit.mockResolvedValue([invitedRow]);

    const result = await processor.process(job());

    expect(result).toEqual({ status: 'sent' });
    expect(mailService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invitee@example.com',
        subject: expect.stringContaining('Acme'),
        html: expect.stringContaining(
          `accept-invite?token=${encodeURIComponent(token)}`,
        ),
      }),
    );
  });

  it('sends when the invitee already has an account (recipient still membership email)', async () => {
    redis.get.mockResolvedValue(token);
    limit.mockResolvedValue([{ ...invitedRow, email: 'existing@example.com' }]);

    expect(await processor.process(job())).toEqual({ status: 'sent' });
    expect(mailService.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'existing@example.com' }),
    );
  });

  it('skips when the token is gone (expired, consumed, or removed)', async () => {
    redis.get.mockResolvedValue(null);

    expect(await processor.process(job())).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
    expect(limit).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('invite skipped', {
      membershipId,
      reason: 'token_gone',
    });
  });

  it('skips when the membership row is gone (removed after enqueue)', async () => {
    redis.get.mockResolvedValue(token);
    limit.mockResolvedValue([]);

    expect(await processor.process(job())).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('invite skipped', {
      membershipId,
      reason: 'membership_gone',
    });
  });

  it('skips when the membership is no longer INVITED (accepted elsewhere)', async () => {
    redis.get.mockResolvedValue(token);
    limit.mockResolvedValue([
      { ...invitedRow, status: 'ACTIVE', invitedRole: null },
    ]);

    expect(await processor.process(job())).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith('invite skipped', {
      membershipId,
      reason: 'not_invited',
    });
  });

  it('skips loudly when an INVITED row has no invited role', async () => {
    redis.get.mockResolvedValue(token);
    limit.mockResolvedValue([{ ...invitedRow, invitedRole: null }]);

    expect(await processor.process(job())).toEqual({ status: 'skipped' });
    expect(mailService.send).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith('invite skipped', {
      membershipId,
      reason: 'missing_invited_role',
    });
  });

  it('throws a retryable error for transient SMTP failures (4xx)', async () => {
    redis.get.mockResolvedValue(token);
    limit.mockResolvedValue([invitedRow]);
    mailService.send.mockRejectedValue(
      new MailTransportError('timeout', false),
    );

    await expect(processor.process(job())).rejects.toThrow('timeout');
  });

  it('throws UnrecoverableError for permanent SMTP failures (5xx)', async () => {
    redis.get.mockResolvedValue(token);
    limit.mockResolvedValue([invitedRow]);
    mailService.send.mockRejectedValue(
      new MailTransportError('no such user', true),
    );

    await expect(processor.process(job())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
