import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  JOB_SEND_ACCOUNT_EXISTS,
  JOB_SEND_VERIFICATION,
  MAIL_QUEUE,
} from './constants/mail.constants';

/**
 * Producer API for the email queue. Only methods AuthService calls live here.
 * Job payloads carry `userId` only — no PII, no tokens (token stays in Redis);
 * processors re-fetch fresh state at execution time.
 */
@Injectable()
export class MailQueue {
  constructor(@Inject(MAIL_QUEUE) private readonly queue: Queue) {}

  async enqueueVerification(userId: string): Promise<void> {
    await this.queue.add(
      JOB_SEND_VERIFICATION,
      { userId },
      {
        // At most one pending verification job per user; keepLastIfActive
        // stores the newest add so a regenerated token's job always runs.
        deduplication: { id: `verify:${userId}`, keepLastIfActive: true },
        attempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 3_600, count: 100 },
        removeOnFail: { age: 86_400 },
      },
    );
  }

  async enqueueAccountExists(userId: string): Promise<void> {
    await this.queue.add(
      JOB_SEND_ACCOUNT_EXISTS,
      { userId },
      {
        deduplication: {
          id: `account-exists:${userId}`,
          keepLastIfActive: true,
        },
        attempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 3_600, count: 100 },
        removeOnFail: { age: 86_400 },
      },
    );
  }
}
