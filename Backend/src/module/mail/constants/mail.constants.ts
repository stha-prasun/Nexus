export const QUEUE_EMAIL = 'email';
export const JOB_SEND_VERIFICATION = 'send-verification';
export const JOB_SEND_ACCOUNT_EXISTS = 'send-account-exists';

/** Injection tokens for the BullMQ producer queue and consumer worker. */
export const MAIL_QUEUE = 'MAIL_QUEUE';
export const MAIL_WORKER = 'MAIL_WORKER';

const concurrency = Number(process.env.MAIL_WORKER_CONCURRENCY ?? 3);

/** In-process worker concurrency (default 3). */
export const MAIL_WORKER_CONCURRENCY =
  Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 3;
