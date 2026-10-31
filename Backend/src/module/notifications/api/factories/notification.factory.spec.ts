import {
  DUE_REMINDER_TYPE,
  DUE_SOON_TITLE,
  DUE_TODAY_TITLE,
  TASK_ASSIGNED_TITLE,
  TASK_ASSIGNED_TYPE,
} from '../constants/notifications.constants';
import type { ReminderTaskSnapshot } from './notification.factory';
import { NotificationFactory } from './notification.factory';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Structural snapshot — same shape the tasks scheduler passes in. */
const candidate = (
  overrides: Partial<ReminderTaskSnapshot> = {},
): ReminderTaskSnapshot => ({
  taskId: uuid(9),
  assigneeId: uuid(1),
  key: 'WR-4',
  title: 'Wire up auth flow',
  dueDate: '2026-06-15',
  ...overrides,
});

const task = (overrides: Record<string, string> = {}) => ({
  id: uuid(9),
  key: 'WR-4',
  title: 'Wire up auth flow',
  ...overrides,
});

describe('NotificationFactory', () => {
  const factory = new NotificationFactory();

  describe('createDueReminder (dedupe re-arm on due-date change)', () => {
    it('embeds the due date in the dedupe key — editing the date re-arms both windows', () => {
      const first = factory.createDueReminder(
        candidate({ dueDate: '2026-06-15' }),
        'due_soon',
      );
      const moved = factory.createDueReminder(
        candidate({ dueDate: '2026-06-20' }),
        'due_soon',
      );
      expect(first.dedupeKey).toBe('due_soon:2026-06-15');
      expect(moved.dedupeKey).toBe('due_soon:2026-06-20');
      // Different key → the ON CONFLICT lets the new window land again.
      expect(moved.dedupeKey).not.toBe(first.dedupeKey);
    });

    it('uses window-specific titles and the due_reminder type with key+title+date body', () => {
      const soon = factory.createDueReminder(candidate(), 'due_soon');
      const today = factory.createDueReminder(candidate(), 'due_today');
      expect(soon).toMatchObject({
        type: DUE_REMINDER_TYPE,
        title: DUE_SOON_TITLE,
        dedupeKey: 'due_soon:2026-06-15',
      });
      expect(today).toMatchObject({
        type: DUE_REMINDER_TYPE,
        title: DUE_TODAY_TITLE,
        dedupeKey: 'due_today:2026-06-15',
      });
      expect(today.body).toBe('WR-4 "Wire up auth flow" — due 2026-06-15.');
      // Reminders are per-assignee (reassignment gives the new assignee keys).
      expect(soon.userId).toBe(uuid(1));
    });
  });

  describe('createTaskAssigned', () => {
    it('snapshots key, title and project name into the body', () => {
      const row = factory.createTaskAssigned(uuid(2), task(), 'Web Platform');
      expect(row).toMatchObject({
        userId: uuid(2),
        type: TASK_ASSIGNED_TYPE,
        taskId: uuid(9),
        title: TASK_ASSIGNED_TITLE,
        body: 'WR-4 "Wire up auth flow" — Web Platform',
      });
    });

    it('never dedupes — reassignment must always insert', () => {
      const row = factory.createTaskAssigned(uuid(2), task(), 'Web Platform');
      expect(row.dedupeKey).toBeNull();
    });
  });
});
