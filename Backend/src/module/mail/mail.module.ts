import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import {
  JOB_SEND_ACCOUNT_EXISTS,
  JOB_SEND_VERIFICATION,
  MAIL_QUEUE,
  MAIL_TRANSPORT,
  MAIL_WORKER,
  MAIL_WORKER_CONCURRENCY,
  QUEUE_EMAIL,
} from './constants/mail.constants';
import { MailQueue } from './mail.queue';
import { MailService } from './mail.service';
import { SendAccountExistsProcessor } from './processors/send-account-exists.processor';
import { SendVerificationProcessor } from './processors/send-verification.processor';
import { createMailTransport } from './transports/create-mail-transport';
import type { MailTransport } from './transports/mail-transport';

const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

// BullMQ opens its own Redis clients from these options — we deliberately do
// not share the app's REDIS_CLIENT (different lifecycle/pooling needs).
const redisConnection = (): { host: string; port: number } => ({
  host: env('REDIS_HOST', 'localhost'),
  port: Number(env('REDIS_PORT', '6379')),
});

// Provider is chosen purely by MAIL_PROVIDER (.env) — smtp | resend.
const mailTransportProvider = {
  provide: MAIL_TRANSPORT,
  useFactory: (): MailTransport => createMailTransport(),
};

const queueProvider = {
  provide: MAIL_QUEUE,
  useFactory: (): Queue =>
    new Queue(QUEUE_EMAIL, { connection: redisConnection() }),
};

const workerProvider = {
  provide: MAIL_WORKER,
  inject: [SendVerificationProcessor, SendAccountExistsProcessor],
  useFactory: (
    verification: SendVerificationProcessor,
    accountExists: SendAccountExistsProcessor,
  ): Worker =>
    new Worker(
      QUEUE_EMAIL,
      async (job) => {
        if (job.name === JOB_SEND_VERIFICATION) {
          return verification.process(job);
        }
        if (job.name === JOB_SEND_ACCOUNT_EXISTS) {
          return accountExists.process(job);
        }
        return undefined;
      },
      { connection: redisConnection(), concurrency: MAIL_WORKER_CONCURRENCY },
    ),
};

// Factory-created queue/worker need explicit lifecycle: Nest does not call
// hooks on factory results (same pattern as PostgresPoolShutdown).
@Injectable()
class MailQueueShutdown implements OnModuleDestroy {
  constructor(
    @Inject(MAIL_QUEUE) private readonly queue: Queue,
    @Inject(MAIL_WORKER) private readonly worker: Worker,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}

@Module({
  imports: [DatabaseModule, RedisModule],
  providers: [
    mailTransportProvider,
    queueProvider,
    workerProvider,
    MailQueueShutdown,
    MailService,
    MailQueue,
    SendVerificationProcessor,
    SendAccountExistsProcessor,
  ],
  exports: [MailQueue],
})
export class MailModule {}
