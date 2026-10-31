import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Redis } from 'ioredis';
import {
  NotificationFactory,
  type ReminderWindow,
} from '../../notifications/api/factories/notification.factory';
import { NotificationsService } from '../../notifications/api/notifications.service';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import { ReminderRepository } from './repositories/reminder.repository';

/**
 * Redis lock — a plain `SET NX EX` guard so overlapping ticks (or a second
 * instance) don't run the sweep twice. TTL **600 s < the 900 s interval**
 * (review fix #7): a lock can never survive to the next tick, so even a
 * crash between acquire and release skips at most one tick. It is only an
 * *optimization* — correctness comes from `ON CONFLICT DO NOTHING` on the
 * (task, user, dedupeKey) unique, so the worst realistic case is one skipped
 * tick or a duplicate no-op insert.
 */
export const REMINDER_LOCK_KEY = 'nexus:tasks:reminder-lock';
export const REMINDER_LOCK_TTL_SECONDS = 600;
export const REMINDER_CRON = '*/15 * * * *';

/** `due_today` opens at 09:00 UTC on the due date (plan §7). */
const DUE_TODAY_OPENS_AT_MS = 9 * 60 * 60 * 1000;

/** Today as `YYYY-MM-DD` in UTC — the same clock the DTO rules use. */
export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

/** `date ± n days` as `YYYY-MM-DD` — pure string/UTC math, no local tz. */
export const addUtcDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * Which reminder window (if any) `now` is inside for `dueDate`, both in UTC:
 *
 * - **`due_soon`** — the entire previous calendar day
 *   (`dueDate - 1 ≤ now < dueDate`), i.e. `dueDate` is tomorrow;
 * - **`due_today`** — from 09:00 on the due date until midnight.
 *
 * Everything else is null: an earlier date means both windows already
 * passed (no back-fill, no overdue nagging — confirmed scope), a later date
 * means neither has opened, and a due date earlier than 09:00 today waits
 * for the 09:00 tick. Exported as a pure function so the boundaries are
 * unit-testable without a cron tick.
 */
export const reminderWindowFor = (
  dueDate: string,
  now: Date,
): ReminderWindow | null => {
  const today = utcDate(now);
  if (dueDate === today) {
    const opensAt =
      Date.parse(`${today}T00:00:00.000Z`) + DUE_TODAY_OPENS_AT_MS;
    return now.getTime() >= opensAt ? 'due_today' : null;
  }
  if (dueDate === addUtcDays(today, 1)) return 'due_soon';
  return null;
};

/**
 * Due-date reminder cron (plan §7). Every 15 minutes, under the Redis SETNX
 * lock, it fetches the bounded candidate set (assigned, dated, unfinished,
 * due today/tomorrow, assignee still ACTIVE — `ReminderRepository`) and hands
 * each open window to `NotificationsService.createForUser`, whose
 * `ON CONFLICT DO NOTHING` insert makes the whole sweep idempotent: only a
 * row that actually lands is published to SSE, however often the job runs.
 * The dedupe key embeds the due date, so editing a due date re-arms both
 * windows for the new date while old rows persist as history.
 */
@Injectable()
export class TasksScheduler {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly reminders: ReminderRepository,
    private readonly notifications: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
  ) {}

  @Cron(REMINDER_CRON)
  async sweepDueReminders(): Promise<void> {
    const token = randomUUID();
    const acquired = await this.redis.set(
      REMINDER_LOCK_KEY,
      token,
      'EX',
      REMINDER_LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') return; // another tick holds the lock
    try {
      await this.runSweep(new Date());
    } finally {
      // Best-effort release: only delete our own token; if the read/compare
      // races, the 600 s TTL still guarantees no lock outlives one interval.
      if ((await this.redis.get(REMINDER_LOCK_KEY)) === token) {
        await this.redis.del(REMINDER_LOCK_KEY);
      }
    }
  }

  /**
   * One sweep with an injected clock (tests call this directly). Returns
   * how many notifications actually landed — duplicates (`createForUser`
   * → null) don't count.
   */
  async runSweep(now: Date): Promise<number> {
    const today = utcDate(now);
    const candidates = await this.reminders.findDueCandidates(
      today,
      addUtcDays(today, 1),
    );
    let landed = 0;
    for (const candidate of candidates) {
      const window = reminderWindowFor(candidate.dueDate, now);
      if (window === null) continue;
      const row = await this.notifications.createForUser(
        this.notificationFactory.createDueReminder(candidate, window),
      );
      if (row !== null) landed += 1;
    }
    return landed;
  }
}
