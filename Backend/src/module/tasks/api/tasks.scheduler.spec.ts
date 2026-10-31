import { Test, type TestingModule } from '@nestjs/testing';
import {
  DUE_SOON_TITLE,
  DUE_TODAY_TITLE,
} from '../../notifications/api/constants/notifications.constants';
import { NotificationFactory } from '../../notifications/api/factories/notification.factory';
import { NotificationsService } from '../../notifications/api/notifications.service';
import type { ReminderCandidate } from './repositories/reminder.repository';
import { ReminderRepository } from './repositories/reminder.repository';
import {
  addUtcDays,
  REMINDER_LOCK_KEY,
  reminderWindowFor,
  TasksScheduler,
} from './tasks.scheduler';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const candidate = (
  overrides: Partial<ReminderCandidate> = {},
): ReminderCandidate => ({
  taskId: uuid(9),
  assigneeId: uuid(1),
  key: 'WR-4',
  title: 'Wire up auth flow',
  dueDate: '2026-06-15',
  ...overrides,
});

/** `now` at a fixed UTC clock time on 2026-06-15. */
const at = (hour: number, minute = 0): Date =>
  new Date(
    Date.parse('2026-06-15T00:00:00.000Z') + hour * 3_600_000 + minute * 60_000,
  );

describe('reminderWindowFor (pure window boundaries)', () => {
  it('due_soon covers the whole previous calendar day', () => {
    // dueDate tomorrow → any time today is the day-before window.
    expect(reminderWindowFor('2026-06-16', at(0))).toBe('due_soon');
    expect(reminderWindowFor('2026-06-16', at(12))).toBe('due_soon');
    expect(reminderWindowFor('2026-06-16', at(23, 59))).toBe('due_soon');
  });

  it('due_today opens exactly at 09:00 UTC and stays open until midnight', () => {
    expect(reminderWindowFor('2026-06-15', at(8, 59))).toBeNull();
    expect(reminderWindowFor('2026-06-15', at(9))).toBe('due_today');
    expect(reminderWindowFor('2026-06-15', at(23, 59))).toBe('due_today');
  });

  it('past due dates are never reminded (no back-fill, no overdue nag)', () => {
    expect(reminderWindowFor('2026-06-14', at(12))).toBeNull();
    expect(reminderWindowFor('2026-01-01', at(12))).toBeNull();
  });

  it('future dates beyond the day-before are not yet in any window', () => {
    expect(reminderWindowFor('2026-06-17', at(12))).toBeNull();
    expect(reminderWindowFor('2026-07-01', at(12))).toBeNull();
  });

  it('addUtcDays rolls month boundaries without local-tz drift', () => {
    expect(addUtcDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addUtcDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('TasksScheduler', () => {
  let scheduler: TasksScheduler;

  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };
  const reminders = { findDueCandidates: jest.fn() };
  const notifications = {
    createForUser: jest.fn(),
    publishExisting: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    redis.set.mockResolvedValue('OK');
    redis.get.mockResolvedValue(null);
    redis.del.mockResolvedValue(1);
    reminders.findDueCandidates.mockResolvedValue([]);
    notifications.createForUser.mockResolvedValue({ id: uuid(5) });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksScheduler,
        NotificationFactory,
        { provide: 'REDIS_CLIENT', useValue: redis },
        { provide: ReminderRepository, useValue: reminders },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    scheduler = module.get<TasksScheduler>(TasksScheduler);
  });

  describe('sweepDueReminders (Redis SETNX lock)', () => {
    it('skips the tick entirely when another holder owns the lock', async () => {
      redis.set.mockResolvedValue(null); // NX refused

      await scheduler.sweepDueReminders();

      expect(reminders.findDueCandidates).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
      // TTL < interval is what keeps a stale lock from outliving one tick.
      expect(redis.set).toHaveBeenCalledWith(
        REMINDER_LOCK_KEY,
        expect.any(String),
        'EX',
        600,
        'NX',
      );
    });

    it('runs the sweep and releases its own token when acquired', async () => {
      const sweep = jest.spyOn(scheduler, 'runSweep').mockResolvedValue(0);
      // The release path compares against the token `set` received.
      redis.get.mockImplementation(async () => redis.set.mock.calls[0]?.[1]);

      await scheduler.sweepDueReminders();

      expect(sweep).toHaveBeenCalledTimes(1);
      expect(redis.get).toHaveBeenCalledWith(REMINDER_LOCK_KEY);
      expect(redis.del).toHaveBeenCalledWith(REMINDER_LOCK_KEY);
    });

    it('releases nothing when the token no longer matches (foreign lock)', async () => {
      jest.spyOn(scheduler, 'runSweep').mockResolvedValue(0);
      redis.get.mockResolvedValue('someone-elses-token');

      await scheduler.sweepDueReminders();

      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('runSweep (window dispatch + idempotency)', () => {
    const NOW = at(10); // 10:00 UTC on 2026-06-15

    it('only hands open-window candidates to createForUser', async () => {
      reminders.findDueCandidates.mockResolvedValue([
        candidate({ dueDate: '2026-06-15' }), // today, ≥09:00 → due_today
        candidate({ taskId: uuid(10), dueDate: '2026-06-16' }), // tomorrow → due_soon
        candidate({ taskId: uuid(11), dueDate: '2026-06-14' }), // passed → skipped
      ]);

      const landed = await scheduler.runSweep(NOW);

      expect(landed).toBe(2);
      expect(notifications.createForUser).toHaveBeenCalledTimes(2);
      expect(notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: uuid(9),
          title: DUE_TODAY_TITLE,
          dedupeKey: 'due_today:2026-06-15',
        }),
      );
      expect(notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: uuid(10),
          title: DUE_SOON_TITLE,
          dedupeKey: 'due_soon:2026-06-16',
        }),
      );
    });

    it('queries exactly today + tomorrow — the only two windowable dates', async () => {
      await scheduler.runSweep(NOW);
      expect(reminders.findDueCandidates).toHaveBeenCalledWith(
        '2026-06-15',
        '2026-06-16',
      );
    });

    it('skips candidates whose window is not open yet (pre-09:00 tick)', async () => {
      reminders.findDueCandidates.mockResolvedValue([
        candidate({ dueDate: '2026-06-15' }),
      ]);

      const landed = await scheduler.runSweep(at(8, 59));

      expect(landed).toBe(0);
      expect(notifications.createForUser).not.toHaveBeenCalled();
    });

    it('ON CONFLICT duplicates (createForUser → null) do not count as landed', async () => {
      reminders.findDueCandidates.mockResolvedValue([
        candidate(),
        candidate({ taskId: uuid(10) }),
      ]);
      notifications.createForUser
        .mockResolvedValueOnce(null) // already inserted by a prior tick
        .mockResolvedValueOnce({ id: uuid(6) });

      const landed = await scheduler.runSweep(NOW);

      expect(landed).toBe(1);
      // Both were attempted — dedupe lives in the insert, not here.
      expect(notifications.createForUser).toHaveBeenCalledTimes(2);
    });
  });
});
