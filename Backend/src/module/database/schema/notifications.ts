import { sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { tasks } from './tasks';
import { users } from './users';

/**
 * One persisted in-dashboard notification per recipient.
 *
 * `title`/`body` are **snapshots**, not joins: a notification must render
 * correctly after the task is renamed or reassigned and must not 404
 * mid-render. Task deletion cascades its notifications; user deletion
 * cascades theirs.
 *
 * `type` is a plain varchar (not an enum) — exactly `task_assigned` and
 * `due_reminder` ship today, and future types must not need a PG enum
 * migration.
 *
 * `dedupeKey` makes reminders strictly idempotent per (task, user, kind,
 * date): `due_soon:2026-11-05` | `due_today:2026-11-05`. Assignment rows
 * keep it NULL — PG treats NULLs as distinct in unique indexes, so every
 * assignment change is a fresh row while reminders never duplicate.
 *
 * `readAt` NULL = unread; the center's `unreadCount` is always derived
 * from the DB, never a client tally.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 30 }).notNull(),
    taskId: uuid('task_id').references(() => tasks.id, {
      onDelete: 'cascade',
    }),
    title: varchar('title', { length: 200 }).notNull(),
    body: varchar('body', { length: 500 }).notNull(),
    dedupeKey: varchar('dedupe_key', { length: 64 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Reminder idempotency (ON CONFLICT target). NULL dedupeKey rows
    // (assignments) never collide — PG NULLs are distinct.
    unique('notifications_task_user_dedupe_unique').on(
      table.taskId,
      table.userId,
      table.dedupeKey,
    ),
    // Center pagination: newest-first ordering + `(createdAt, id)` cursor.
    index('notifications_user_created_id_idx').on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    // Unread badge counts.
    index('notifications_user_unread_idx')
      .on(table.userId)
      .where(sql`read_at IS NULL`),
  ],
);
