/**
 * Notification types — exactly two ship today. Stored as `varchar(30)` in
 * the schema (not a PG enum) so a future type never needs an enum migration;
 * this array is the API-boundary whitelist (`@IsIn`) and the Swagger enum.
 */
export const NOTIFICATION_TYPES = ['task_assigned', 'due_reminder'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const TASK_ASSIGNED_TYPE: NotificationType = 'task_assigned';
export const DUE_REMINDER_TYPE: NotificationType = 'due_reminder';

/**
 * Reminder dedupe keys — `(task, user, kind, date)` is unique in the DB, so
 * the 15-minute sweep is idempotent however often it runs. The date embeds
 * in the key: changing a task's `dueDate` re-arms both windows for the new
 * date while old rows persist as history (plan §7).
 */
export const dueSoonDedupeKey = (dueDate: string): string =>
  `due_soon:${dueDate}`;

export const dueTodayDedupeKey = (dueDate: string): string =>
  `due_today:${dueDate}`;

/** Snapshot copy for `task_assigned` rows (title survives task edits). */
export const TASK_ASSIGNED_TITLE = 'Task assigned to you';

/** Reminder snapshot titles (body carries key + title + due date). */
export const DUE_SOON_TITLE = 'Task due soon';
export const DUE_TODAY_TITLE = 'Task due today';

/**
 * Cursor timestamp shape — exactly what `to_char(createdAt AT TIME ZONE
 * 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` emits: six fraction digits, always
 * JS-safe (a JS Date round-trips only milliseconds, which is what the fixed
 * width protects against at the page boundary).
 */
export const NOTIFICATION_CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** List defaults — small roster, no infinite growth (plan §1 scale). */
export const NOTIFICATION_DEFAULT_LIMIT = 30;
export const NOTIFICATION_MAX_LIMIT = 50;

/** 404 — row missing *or* belongs to another user (no ownership leak). */
export const NOTIFICATION_NOT_FOUND_STATUS = 'notification_not_found';
export const NOTIFICATION_NOT_FOUND_MESSAGE = 'Notification not found.';

/** 400 — cursor shipped half a pair (createdAt without id or vice versa). */
export const INVALID_CURSOR_STATUS = 'invalid_cursor';
export const INVALID_CURSOR_MESSAGE =
  'Provide both cursorCreatedAt and cursorId, or neither.';

/**
 * Redis pub/sub channel for live notifications. One shared channel (plain
 * `subscribe`, never `psubscribe`) — every process/cron publishes here and
 * every connected node's SSE listener fans it out to that user's streams.
 */
export const NOTIFICATIONS_CHANNEL = 'nexus:notifications';

/**
 * SSE event names. `ping` is a **named** event rather than an `: comment`
 * because Nest's `MessageEvent` has no comment field; clients simply never
 * subscribe to it (browsers only deliver listened names to handlers).
 */
export const NOTIFICATION_EVENT = 'notification';
export const PING_EVENT = 'ping';
export const SESSION_EXPIRED_EVENT = 'session_expired';

/** Heartbeat cadence — well under proxy idle timeouts (plan §6). */
export const SSE_HEARTBEAT_MS = 25_000;
