import { Inject, Injectable } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppLogger } from '../../../common/logger/logger';
import { verificationUserKey } from '../../auth/api/constants/auth.constants';
import { DRIZZLE } from '../../database/constants/database.contants';
import type { Database } from '../../database/interfaces/database.interfaces';
import { users } from '../../database/schema';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import { MailService } from '../mail.service';
import {
  buildVerifyEmail,
  buildVerifyEmailLink,
} from '../templates/verify-email';
import { classifySmtpError } from './smtp-error';

const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

export interface VerificationJobResult {
  status: 'sent' | 'skipped';
}

/**
 * Sends the verification email for one job. The payload is only `userId`;
 * the token and user are re-fetched at execution time so the latest state
 * always wins. A missing/consumed token or already-verified user completes
 * as `skipped` — not failed — to avoid wasted SMTP calls and retry storms.
 */
@Injectable()
export class SendVerificationProcessor {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly mailService: MailService,
    logger: AppLogger,
  ) {
    this.log = logger.child('mail:verify');
  }

  async process(job: Job<{ userId: string }>): Promise<VerificationJobResult> {
    const { userId } = job.data;

    const token = await this.redis.get(verificationUserKey(userId));
    if (token === null) {
      return { status: 'skipped' };
    }

    const rows = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = rows[0];
    if (user === undefined || user.emailVerifiedAt !== null) {
      return { status: 'skipped' };
    }

    const link = buildVerifyEmailLink(
      env('FRONTEND_URL', 'http://localhost:5173'),
      token,
    );
    const content = buildVerifyEmail(user.name, link);

    try {
      await this.mailService.send({ to: user.email, ...content });
    } catch (error) {
      this.log.error('verification email failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw classifySmtpError(error);
    }

    return { status: 'sent' };
  }
}
