import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../../tasks/api/constants/tasks.constants';
import { projects } from './projects';
import { users } from './users';

/**
 * Board columns as a native Postgres enum, derived from the tasks module's
 * TASK_STATUSES — the same array behind `@IsIn(TASK_STATUSES)` at the API
 * boundary, so schema and DTO can't drift (mirrors `roleEnum`). Append-only:
 * new columns are added to the tail, never reordered.
 */
export const taskStatusEnum = pgEnum('task_status', [...TASK_STATUSES]);

/** Priorities as a native enum — same append-only rule as `task_status`. */
export const taskPriorityEnum = pgEnum('task_priority', [...TASK_PRIORITIES]);

/**
 * One row per project-scoped task. `key` (`WR-4`) is stored, not computed at
 * read time: renaming a project must never rewrite task keys, and the seq
 * comes from a monotonic per-project counter (`projects.taskCounter`), so a
 * deleted key is never reissued while notifications/bookmarks still
 * reference it (plan §8.2). `seq` is display/ordering material only —
 * `unique(projectId, seq)` is the backstop behind the advisory lock.
 *
 * `assigneeId` is SET NULL on user deletion and is also nulled by the
 * member-removal hooks (plan §8.3) so a removed member never keeps
 * reminders for a task they can now only 404 on. NULL = unassigned.
 *
 * `dueDate` is date-only and compared in UTC (server clock) — no timezone
 * math, no client-tz guessing (plan §1).
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    key: varchar('key', { length: 20 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    dueDate: date('due_date'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      // Stamped by Drizzle on every UPDATE through the query builder.
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Backstop behind the advisory-locked taskCounter increment (§8.2).
    unique('tasks_project_seq_unique').on(table.projectId, table.seq),
    // Member-removal unassign hooks + "my tasks".
    index('tasks_assignee_id_idx').on(table.assigneeId),
    // Board fetch.
    index('tasks_project_id_idx').on(table.projectId),
    // Reminder sweep: assigned, dated, unfinished tasks only.
    index('tasks_reminder_sweep_idx')
      .on(table.status, table.dueDate)
      .where(sql`assignee_id IS NOT NULL AND due_date IS NOT NULL`),
  ],
);
