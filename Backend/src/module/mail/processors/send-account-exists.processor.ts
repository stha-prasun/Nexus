import { Inject, Injectable } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { AppLogger } from '../../../common/logger/logger';
import { DRIZZLE } from '../../database/constants/database.contants';
import type { Database } from '../../database/interfaces/database.interfaces';
import { users } from '../../database/schema';
import { MailService } from '../mail.service';
import { buildAccountExistsEmail } from '../templates/account-exists';
import { classifySmtpError } from './smtp-error';

export interface AccountExistsJobResult {
  status: 'sent' | 'skipped';
}

/**
 * Notifies the owner of an already-verified account that someone tried to
 * register again. Payload is only `userId` — the address is re-fetched so
 * no PII sits in queue data.
 */
@Injectable()
export class SendAccountExistsProcessor {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly mailService: MailService,
    logger: AppLogger,
  ) {
    this.log = logger.child('mail:account-exists');
  }

  async process(job: Job<{ userId: number }>): Promise<AccountExistsJobResult> {
    const { userId } = job.data;

    const rows = await this.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = rows[0];
    if (user === undefined) {
      return { status: 'skipped' };
    }

    try {
      await this.mailService.send({
        to: user.email,
        ...buildAccountExistsEmail(user.name),
      });
    } catch (error) {
      this.log.error('account-exists email failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw classifySmtpError(error);
    }

    return { status: 'sent' };
  }
}
