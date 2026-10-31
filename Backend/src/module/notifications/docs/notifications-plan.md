# Notifications Module — Companion Note

Short companion to `tasks/docs/tasks-plan.md` (§5–§7 are canonical there).
This module owns **persistence + delivery** of in-dashboard notifications;
the tasks module owns **when** a notification is created (assignment
side-effects, due-date reminder sweep).

## Schema (`module/database/schema/notifications.ts`)

- `type varchar(30)` — `task_assigned` | `due_reminder` (extensible varchar,
  not a PG enum: a future type must not need an enum migration).
- Snapshots (`title`, `body`) instead of joins — the row must render after
  the task is renamed/reassigned and must never 404 mid-render. Task
  deletion cascades; user deletion cascades.
- `dedupeKey` — `due_soon:<date>` / `due_today:<date>` / NULL. Unique on
  `(taskId, userId, dedupeKey)`; PG treats NULLs as distinct, so reminder
  inserts are strictly idempotent while assignment rows (NULL) never collide.
- `readAt NULL = unread`; `unreadCount` is always DB-derived.

## REST contract

| Route | Behavior |
|---|---|
| `GET /notifications?limit&cursorCreatedAt&cursorId` | Own rows, newest first, `default 30 / max 50` → `{ notifications, unreadCount, nextCursor }` |
| `PATCH /notifications/:id/read` | Not-yours → 404 `notification_not_found`; already read → 204 no-op |
| `POST /notifications/read-all` | `readAt = now()` for the caller's unread rows → 204 |
| `GET /notifications/stream` | SSE, `@SkipThrottle()`, Session + ActiveMember guards |

**Cursor (review fix #4):** `createdAt` is selected as a fixed-width UTC
string (`to_char(createdAt AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
always six fraction digits, JS-safe) and the filter is a Postgres row-value
comparison `(createdAt, id) < ($ts::timestamptz, $id::uuid)` — microsecond
boundary and id tie-break evaluated in the database, so a burst between page
fetches can never skip or duplicate rows. Half a cursor → 400
`invalid_cursor`.

## SSE contract

- Events: `notification` (payload = one `NotificationResponseDto`), `ping`
  (named heartbeat every 25 s — Nest `MessageEvent` has no comment field,
  so `: ping` comments are impossible; clients never subscribe to `ping`),
  `session_expired` (heartbeat found a dead session → stream completes).
- Transport: `EventSource(url, { withCredentials: true })`; auto-reconnect,
  and the client reconciles by re-fetching `GET /notifications` on every
  `open` (no replay on connect — SSE is an append channel, dedupe by `id`).
- Fan-out: per-connection `Subject`s in-process + a Redis subscriber
  (`redis.duplicate()`, plain `subscribe('nexus:notifications')`) so every
  node and the cron process reach every browser.

## Dependency direction

`TasksModule → NotificationsModule` only. This module never imports
`TasksModule`.
