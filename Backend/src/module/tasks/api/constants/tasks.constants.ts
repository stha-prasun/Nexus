/**
 * Task board statuses — append-only (mirrors `ROLES`/`MEMBER_STATUSES`: the
 * schema's `task_status` PG enum is built from this array, so new columns
 * are appended to the tail, never reordered).
 */
export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'in_review',
  'on_hold',
  'testing',
  'resolved',
  'done',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Statuses that count as finished: the reminder sweep skips them (no due
 * reminders for work that is already closed). Reopening a task re-arms the
 * remaining window — no row is written while it sits in one of these.
 */
export const FINISHED_TASK_STATUSES = ['done', 'resolved'] as const;

export const isFinishedStatus = (status: TaskStatus): boolean =>
  status === 'done' || status === 'resolved';

/**
 * Priorities — append-only, same rule as statuses (schema `task_priority`
 * PG enum source). Default matches the schema column default and the
 * create DTO's fallback (`DEFAULT_TASK_PRIORITY`).
 */
export const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const DEFAULT_TASK_STATUS: TaskStatus = 'todo';
export const DEFAULT_TASK_PRIORITY: TaskPriority = 'medium';

/**
 * Board ordering rank — lower sorts first, so the drag board renders
 * urgent work at the top of every column (plan §3.1 `priorityRank`).
 */
export const TASK_PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Date-only `YYYY-MM-DD` — paired with `@IsISO8601({ strict: true })` in the
 * DTOs: the strict mode rejects impossible calendar dates (`2026-13-40`,
 * `2026-02-30`) that this regex alone would accept (and Postgres would then
 * reject as a 500); the regex rejects ISO datetimes the strict mode allows.
 * One source for both DTOs.
 */
export const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Key prefix material for `task.key` — first letters of up to three words of
 * the project name (`Website relaunch` → `WR-4`). Derived once at creation
 * and stored immutably: a later project rename never rewrites task keys.
 * Mirrors the frontend's display-only `keyPrefix()` in `lib/board.ts`.
 */
export const taskKeyPrefix = (projectName: string): string =>
  projectName
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase();

/** 404 — project missing *or* invisible to the actor (no existence leak). */
export const TASK_PROJECT_NOT_FOUND_STATUS = 'task_project_not_found';
export const TASK_PROJECT_NOT_FOUND_MESSAGE = 'Project not found.';

/** 404 — task missing *or* its project is invisible to the actor. */
export const TASK_NOT_FOUND_STATUS = 'task_not_found';
export const TASK_NOT_FOUND_MESSAGE = 'Task not found.';

/** 400 — due date is before today (UTC server clock); "today" is allowed. */
export const DUE_DATE_PAST_STATUS = 'due_date_past';
export const DUE_DATE_PAST_MESSAGE = 'The due date cannot be in the past.';

/**
 * 400 — the assignment matrix rejected the target: not a project member,
 * an HR target, a role that may not be targeted by this actor, …
 */
export const ASSIGN_TARGET_INVALID_STATUS = 'assign_target_invalid';
export const ASSIGN_TARGET_INVALID_MESSAGE =
  'That person cannot be assigned this task. Pick a member of the project with an allowed role.';

/** 400 — PATCH body carried no editable field (mirrors projects). */
export const EMPTY_UPDATE_STATUS = 'empty_update';
export const EMPTY_UPDATE_MESSAGE = 'Provide at least one field to update.';

/**
 * 409 — the `unique(projectId, seq)` backstop tripped: a concurrent create
 * slipped past the advisory lock (or a stale counter was repaired by hand).
 * The client retries; the counter itself never reuses a deleted seq.
 */
export const TASK_KEY_CONFLICT_STATUS = 'task_key_conflict';
export const TASK_KEY_CONFLICT_MESSAGE =
  'Could not allocate a task key. Please try again.';
