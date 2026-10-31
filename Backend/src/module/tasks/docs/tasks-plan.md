# Tasks Module — Implementation Plan

Plan for the tasks feature: project-scoped kanban tasks with a strict assignment matrix (Admin/PM/Lead/Dev), free status flow across seven columns, past-due-date rejection, an in-dashboard **notification center** backed by a persisted notifications table and a live **SSE** stream, plus a scheduler that reminds assignees as due dates approach. Full-stack: backend (tasks + net-new notifications module + scheduler) + frontend wiring (the board UI is already built on demo state).

> **Revision notes** — this revision folds in nine review fixes: (1) due-date DTO validation uses `@IsISO8601({strict})` + date-only regex (the old `@Matches` alone accepted `2026-13-40` and 500'd in Postgres); (2) Admin may target Admin members (resolves the self-assign contradiction); (3) the SSE route uses `@SkipThrottle()` (the old "limit: 5" was both too low and invalid throttler-v6 syntax); (4) notification cursor pagination compares at full microsecond precision in Postgres; (5) SSE heartbeat is a named `ping` event (Nest `MessageEvent` has no comment field); (6) plain `subscribe`, not `psubscribe`; (7) scheduler lock TTL 600 s < 15-min interval (was equal → self-race); (8) per-project `taskCounter` replaces `MAX(seq)+1` (which reused keys of deleted highest tasks); (9) removing a member from a project **or the org** unassigns their tasks, and the reminder sweep requires an ACTIVE project membership (the old edge 16 wrongly claimed the FK `SET NULL` covered org removal — that FK only fires on user deletion). Commit strategy: **one backend commit, one frontend commit**.

## 1. Confirmed decisions

| Decision | Answer |
|---|---|
| Scope | **Project-scoped only** — every task belongs to a project. No standalone/personal tasks. Task key = `PREFIX-Seq` (e.g. `WR-4`), stored immutably at creation |
| Assignable targets | **Admin → Dev, PM, or Admin** project members (never HR — widened in revision so Admin self-assign works). **PM / project Lead → Devs only**. **Dev → self only, on create** |
| PM as assignee | A PM receives tasks **only from Admin** (never from a Lead or peer PM) |
| Self-create | A Dev may create a task for themselves; on create the assignee is forced to self. A Dev may never reassign afterwards. Assigning **to yourself** (any role) sends **no notification** |
| HR | **Read-only**: may `GET` the board/tasks; every mutation → 403 `role_forbidden`. Frontend switches the locked screen to a read-only board |
| Assignment rule | Assignee must already be an **ACTIVE member of that project** — assigning a non-member → 400 `assign_target_invalid` |
| Member removal | Removing someone from a project **or from the org** unassigns every task assigned to them (§8.3). The reminder sweep additionally requires an ACTIVE project membership as a backstop |
| Status flow | **Free transitions** — any of the 7 statuses from any status (drag-and-drop stays simple) |
| Priorities | `urgent`, `high`, `medium`, `low` (default `medium`) |
| Due date | Optional; when present must be **≥ today (UTC)** on create and on change → else 400 `due_date_past`. "Yesterday" is always rejected; "today" is allowed |
| Due reminders | **Two per due-date per assignee**: day-before (`due_soon`), and 09:00 on the due date (`due_today`). Skipped when status ∈ {`done`, `resolved`} or task unassigned. **No overdue nagging** beyond these two windows |
| Notifications | **Persisted** with read/unread + live SSE push. REST list is the source of truth; SSE only appends live events |
| Notification types | Exactly **`task_assigned`** and **`due_reminder`** now — stored as `varchar` so more types can be added later without a PG enum migration |
| Status change notifies | No — only assignment + due reminders (per confirmed scope) |
| Timezone | Due dates are date-only and compared in **UTC** (server clock) |
| Scale assumption | Small roster, singleton org — task list per project needs no pagination; notifications endpoint is cursor-paginated |
| UI surface | Board already exists (`ProjectBoardPage.tsx` on demo state) — this pass replaces seeds with real API calls, adds the **notification center** (TopBar bell). "My tasks" page is an optional stretch |
| New dependencies | `@nestjs/schedule` (not yet in package.json — flag in review); nothing else |

### 1.1 Permission matrix (single source of truth for `TasksPolicy`)

Actor must be an **ACTIVE org member** on every route (`ActiveMemberGuard`). Definitions: **Lead** = `project_members.is_lead` on that project (a Dev); **member** = row in `project_members`.

**Visibility (GET):**

| Actor | Sees |
|---|---|
| **Admin** | Tasks of all projects |
| **HR** | Tasks of all projects (read-only) |
| **PM** | Tasks of projects they are a member of |
| **Dev** | Tasks of projects they are a member of |

**Mutations:**

| Action | Admin | PM (member) | Lead (member) | Dev (member) | HR | Non-member |
|---|---|---|---|---|---|---|
| Create | ✓ | ✓ | ✓ | ✓ **assignee forced to self** | ✗ | ✗ |
| Edit title/description/priority/due | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Move status | ✓ | ✓ | ✓ | ✓ **own tasks only** | ✗ | ✗ |
| Assign / reassign / unassign | ✓ target ∈ {Dev, PM, Admin} | ✓ target = Dev | ✓ target = Dev | ✗ | ✗ | ✗ |
| Delete | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |

Derived rules:

- **Invisible project → 404 `task_project_not_found`** (missing and forbidden are indistinguishable — no existence leak, mirrors projects-plan §1.1).
- **Visible-but-forbidden → 403 `role_forbidden`** (HR mutation, Dev edit, Dev moving someone else's task, non-lead/non-member PM attempting assign, …).
- **`RolesGuard` alone is never sufficient** — every route also carries `ActiveMemberGuard`; the service re-checks visibility + the assignment matrix (defense in depth), same hard convention as projects/members.
- HR is intentionally **not** gated by `@Roles` on GET routes (role-based visibility branch, not membership-based — HR is never a project member).

### 1.2 Assignment matrix (target validation — `TasksPolicy.canAssignTarget`)

Checked on create-with-assignee and on `POST /tasks/:id/assign`:

| Actor | Allowed targets |
|---|---|
| Admin | Project members with org role **Dev, PM, or Admin** (everyone except HR — so Admin self-assign is a valid silent 200) |
| PM (member) | Project members with org role **Dev** |
| Lead (member) | Project members with org role **Dev** (includes self — a Lead is a Dev) |

Any other combination → **400 `assign_target_invalid`** (target not a project member, target is HR, actor lacks assign rights, …). `assigneeId: null` is always permitted for actors with assign rights (unassign).

## 2. Database

Three new Drizzle schema files under `module/database/schema/`, plus one edit; all exported from `schema/index.ts`. Enums derive from module constants (append-only domains), mirroring `roleEnum`:

**`module/database/schema/tasks.ts`** — [NEW]

```ts
taskStatusEnum = pgEnum('task_status', ['todo','in_progress','in_review','on_hold','testing','resolved','done'])
taskPriorityEnum = pgEnum('task_priority', ['urgent','high','medium','low'])

id            uuid PK default gen_random_uuid()
projectId     uuid not null → projects.id (FK, cascade)
seq           integer not null                    // per-project monotonic counter (from projects.taskCounter)
key           varchar(20) not null                // "WR-4" — immutable even if the project is renamed
title         varchar(200) not null
description   text not null default ''
status        task_status not null default 'todo'
priority      task_priority not null default 'medium'
assigneeId    uuid → users.id (FK, set null)      // NULL = unassigned; also nulled by the member-removal hooks (§8.3)
dueDate       date                                // NULL = no due date
createdByUserId uuid not null → users.id (FK, restrict)
createdAt     timestamptz not null defaultNow()
updatedAt     timestamptz not null defaultNow()   // Drizzle $onUpdate
```

Constraints/indexes: `unique(projectId, seq)`; index on `assigneeId` (removal hooks + "my tasks"), `projectId` (board fetch), and `(status, dueDate)` partial `WHERE assigneeId IS NOT NULL AND dueDate IS NOT NULL` (reminder sweep).

`key` is stored, not computed at read time — renaming a project must not rewrite task keys. `seq` comes from a **monotonic per-project counter** (§8.2): `MAX(seq)+1` is rejected because deleting the highest task would reissue its key (`WR-4` reassigned while notifications/bookmarks still reference the dead task).

**`module/database/schema/notifications.ts`** — [NEW]

```ts
id            uuid PK default gen_random_uuid()
userId        uuid not null → users.id (FK, cascade)   // recipient
type          varchar(30) not null                     // 'task_assigned' | 'due_reminder' (extensible varchar, not enum)
taskId        uuid → tasks.id (FK, cascade)            // NULL only if a future non-task type needs it
title         varchar(200) not null                    // snapshot — survives task edits
body          varchar(500) not null                    // snapshot message text
dedupeKey     varchar(64)                             // 'due_soon:2026-11-05' | 'due_today:2026-11-05' | NULL
readAt        timestamptz                              // NULL = unread
createdAt     timestamptz not null defaultNow()
```

Constraints/indexes: `unique(taskId, userId, dedupeKey)` — PG treats NULLs as distinct in unique indexes, so assignment rows (`dedupeKey NULL`) never collide while reminders are strictly idempotent per (task, user, kind, date); index `(userId, createdAt DESC, id DESC)` for the center's cursor pagination; partial index `(userId) WHERE readAt IS NULL` for unread counts.

Why snapshots instead of joins: a notification must render correctly after the task is renamed or reassigned, and must not 404 mid-render. Task deletion cascades its notifications (a deleted task's reminders are noise anyway). User deletion cascades their notifications.

**`module/database/schema/projects.ts`** — [EDIT]

```ts
taskCounter   integer not null default 0            // monotonic task-seq source; never decremented
```

**`schema/index.ts`** — [EDIT] export both new files (enums included).

Migration: `npm run db:generate` → `drizzle/0009_*.sql` (creates both tables + enums, alters `projects`); `npm run db:migrate` against `POSTGRES_HOST_PORT` (direct port — DDL-unsafe through PgBouncer).

## 3. Endpoints

Routes under the global prefix. Guard order: `SessionAuthGuard → RolesGuard → ActiveMemberGuard` (roles first, per members convention). GET routes skip `RolesGuard` (every role may read; service filters).

### 3.1 Tasks — `/api/v1/projects/:projectId/tasks` + `/api/v1/tasks`

| Route | Guards | Caller |
|---|---|---|
| `GET /projects/:projectId/tasks` | Session → ActiveMember | Visible else 404 |
| `POST /projects/:projectId/tasks` | Session → ActiveMember | Per matrix §1.1 (no `@Roles` — Dev self-create must pass; service enforces) |
| `GET /tasks/:id` | Session → ActiveMember | Visible else 404 |
| `PATCH /tasks/:id` | Session → ActiveMember | Admin / PM member / Lead member |
| `PATCH /tasks/:id/status` | Session → ActiveMember | Full actors **or the assignee of that task** |
| `POST /tasks/:id/assign` | Session → ActiveMember | Admin / PM member / Lead member + target matrix §1.2 |
| `DELETE /tasks/:id` | Session → ActiveMember | Admin / PM member / Lead member |

Service behaviors (all errors `{ status, message }`, constants in `tasks.constants.ts`):

| Route | Behavior |
|---|---|
| `GET /projects/:projectId/tasks` | Invisible project → **404 `task_project_not_found`**. **200 `{ tasks }`** — board payload ordered by `(priorityRank, createdAt)`; each task includes an `assignee` summary (`{ id, name, email }` or `null`) so the board renders avatars without a second fetch |
| `POST /projects/:projectId/tasks` | Body `{ title, description?, status?, priority?, assigneeId?, dueDate? }`. `title` `@Trim @IsNotEmpty @MaxLength(200)`; `description` optional `@IsString @MaxLength(5000)`; `status`/`priority` enum-checked with defaults; `assigneeId` optional uuid; `dueDate` optional **`@IsISO8601({ strict: true })` + `@Matches(/^\d{4}-\d{2}-\d{2}$/)`** — strict mode rejects impossible calendar dates (`2026-13-40`, `2026-02-30`) that a bare regex would accept and Postgres would then reject as a 500; the regex enforces date-only (rejects ISO datetimes). Checks: project visible else 404; HR/Dev-non-self → 403; **Dev ⇒ `assigneeId` forced to self** (any other value → 403 `role_forbidden`); `dueDate < today(UTC)` → **400 `due_date_past`**; assignee present → membership + matrix §1.2 (→ 400 `assign_target_invalid`). **One transaction**: `pg_advisory_xact_lock(hashtext('nexus:project:' \|\| projectId))` → `UPDATE projects SET taskCounter = taskCounter + 1 WHERE id = $projectId RETURNING taskCounter` → `seq` → insert (key = `${keyPrefix(project.name)}-${seq}`). If `assigneeId` set and ≠ actor → **notification `task_assigned` + SSE publish** (§5, after commit). → **201 `{ task }`** |
| `GET /tasks/:id` | Missing or invisible → **404 `task_not_found`**. **200 `{ task }`** |
| `PATCH /tasks/:id` | Body `{ title?, description?, priority?, dueDate? }` (hand-written optional DTO — status and assignee are deliberately **not** editable here). Nothing to change → **400 `empty_update`**. Permission: full actors only (assignee-of-task may **not** edit fields). Due-date field: `@IsISO8601({strict})` + date-only regex as above; reject only when `dueDate` is provided **and differs from the stored value** and `< today` → **400 `due_date_past`** — the no-change exemption lets a title edit on an already-overdue task succeed while resubmitting a *changed* past date still fails. → **200 `{ task }`** |
| `PATCH /tasks/:id/status` | Body `{ status }` enum. Full actors always; a non-full actor must be the task's assignee else **403 `role_forbidden`**. Free transition — no workflow validation. Last-write-wins. → **200 `{ task }`** |
| `POST /tasks/:id/assign` | Body `{ assigneeId: uuid \| null }`. Full actors only; then matrix §1.2 against the *new* value (null skips target checks). Same-value assign → **200 no-op** (no lock, no notification). On change: transaction updates the row; if new assignee **≠ actor** → notification `task_assigned` + SSE publish. Old assignee is **not** notified (scope: assignment only). → **200 `{ task }`** |
| `DELETE /tasks/:id` | Full actors only; deletes the task (notifications cascade). **204** |

Also: params validated as uuid (`ParseUUIDPipe` / `@IsUUID()`); global whitelist pipe strips smuggled fields (`projectId`, `key`, `seq`, `taskCounter`, `createdByUserId`).

### 3.2 Notifications — `/api/v1/notifications` (net-new module)

| Route | Guards | Behavior |
|---|---|---|
| `GET /notifications` | Session → ActiveMember | **200 `{ notifications, unreadCount, nextCursor }`** — recipient's own rows, newest first, cursor-paginated (default limit 30, max 50). **Cursor design (review fix #4):** Postgres timestamps carry microseconds but a JS `Date` round-trip only milliseconds — a naive `createdAt`-based cursor skips or duplicates rows at the page boundary. Therefore the repository selects `createdAt` as a **fixed-width UTC string** (`to_char(createdAt AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` — always six fraction digits, JS-safe), orders by `(createdAt DESC, id DESC)`, and filters `WHERE (createdAt, id) < ($1::timestamptz, $2::uuid)` — the comparison itself runs in Postgres at full precision. `nextCursor` is `{ createdAt, id } \| null` |
| `PATCH /notifications/:id/read` | Session → ActiveMember | Mark one read; not-yours → **404 `notification_not_found`**; already read → 200 no-op. **204** |
| `POST /notifications/read-all` | Session → ActiveMember | `UPDATE … SET readAt = now() WHERE userId = actor AND readAt IS NULL`. **204** |
| `GET /notifications/stream` | Session → ActiveMember | SSE (§6). **`@SkipThrottle()`** (review fix #3) — a long-lived stream plus EventSource reconnects must never be throttled; the session + active-member guards still apply. (Note: throttler v6 requires the `{ default: { limit, ttl } }` shape for `@Throttle` — repo precedent `auth.controller.ts:59` — and a "limit: 5" ceiling would itself have caused the reconnect-storm failure it claimed to prevent) |

## 4. Files — new / rewritten (backend)

```
Backend/src/
├── app.module.ts                                     [EDIT] fix TasksModule import → ./module/tasks/api/tasks.module
│                                                      (also add ScheduleModule.forRoot(), §8.4)
├── package.json                                      [EDIT] add @nestjs/schedule
├── module/
│   ├── database/schema/tasks.ts                      [NEW] §2 tasks table + enums
│   ├── database/schema/notifications.ts              [NEW] §2 notifications table
│   ├── database/schema/projects.ts                   [EDIT] add taskCounter (§2)
│   ├── database/schema/index.ts                      [EDIT] export both new files
│   ├── members/api/repositories/members.repository.ts [EDIT] unassign tasks in removeMember tx (§8.3)
│   ├── projects/api/repositories/projects.repository.ts [EDIT] unassign tasks in removeMember tx (§8.3)
│   ├── notifications/
│   │   ├── docs/notifications-plan.md                [NEW] short companion note (schema + SSE contract; this file §5–§7 is canonical)
│   │   └── api/
│   │       ├── constants/notifications.constants.ts  [NEW] NOTIFICATION_* status/message pairs, types, dedupe helpers
│   │       ├── notifications.module.ts               [NEW] imports AuthModule, DatabaseModule, RedisModule; exports NotificationsService + NotificationEmitterService
│   │       ├── notifications.controller.ts           [NEW] §3.2 routes + Swagger + colocated spec
│   │       ├── notifications.service.ts              [NEW] list/read/read-all + createForUser (insert + emit) + colocated spec
│   │       ├── notifications.repository.ts           [NEW] Drizzle queries, fixed-precision cursor pagination, ON CONFLICT DO NOTHING inserts
│   │       ├── sse/notification-emitter.service.ts   [NEW] per-user Subject registry + Redis pub/sub fan-out + heartbeat (§6)
│   │       ├── dto/notifications-responses.dto.ts    [NEW] NotificationResponseDto + toNotificationResponse() (+ nextCursor)
│   │       └── entities/notification.entity.ts       [NEW]
│   └── tasks/
│       ├── docs/tasks-plan.md                        [NEW] this document
│       └── api/
│           ├── constants/tasks.constants.ts          [NEW] every *_STATUS/*_MESSAGE pair (§3), status/priority arrays
│           ├── policies/tasks.policy.ts              [NEW] visibility + mutation + assignment matrices (§1.1–§1.2), colocated spec
│           ├── entities/task.entity.ts               [REWRITE] Task entity (uuid ids, domain fields)
│           ├── factories/task.factory.ts             [REWRITE] row builder + key derivation
│           ├── repositories/tasks.repository.ts      [REWRITE] Drizzle queries, counter-based create tx (advisory lock), board fetch with assignee join
│           ├── repositories/reminder.repository.ts   [NEW] reminder sweep query (ACTIVE-membership join, §7) + idempotent insert (or folded into tasks.repository)
│           ├── dto/create-task.dto.ts                [REWRITE] §3.1 fields (drop Nest CLI stub)
│           ├── dto/update-task.dto.ts                [REWRITE] hand-written optional title/desc/priority/dueDate (drop PartialType)
│           ├── dto/change-task-status.dto.ts         [NEW] status
│           ├── dto/assign-task.dto.ts                [NEW] assigneeId uuid | null
│           ├── dto/tasks-responses.dto.ts            [NEW] TaskResponseDto + toTaskResponse() (+ assignee summary)
│           ├── tasks.controller.ts                   [REWRITE] §3.1 routes, per-route guards, Swagger, colocated spec
│           ├── tasks.service.ts                      [REWRITE] orchestration + defense-in-depth re-checks + notification side-effects, colocated spec
│           ├── tasks.scheduler.ts                    [NEW] `@nestjs/schedule` cron every 15 min + Redis SETNX guard (§7)
│           └── tasks.module.ts                       [REWRITE] imports AuthModule, DatabaseModule, MembersModule, NotificationsModule
```

Nest CLI stub files (`tasks.controller.spec.ts` / `tasks.service.spec.ts` numeric-id CRUD) are replaced, not extended.

**Dependency direction:** `TasksModule → NotificationsModule` (leaf; imports only Auth/Database/Redis). `NotificationsModule` must **never** import `TasksModule` — the scheduler lives on the tasks side and calls `NotificationsService.createForUser`. `ProjectsModule`/`MembersModule` do **not** import `TasksModule` either (the unassign hooks in §8.3 are shared-schema Drizzle updates inside their existing transactions, per the `members-plan §5.3` cycle-break precedent). One-way imports only.

## 5. Assignment notification flow

Triggered by (a) create-with-assignee where `assigneeId ≠ actor`, and (b) `POST /tasks/:id/assign` where the assignee **changes to a different user**:

1. Insert `notifications` row: `type='task_assigned'`, `userId=assignee`, `taskId`, snapshot `title` ("Task assigned to you") + `body` (task title + key + project name), `dedupeKey=NULL`, `readAt=NULL`.
2. Publish the serialized notification onto Redis pub/sub → every SSE listener delivers to that user (§6).
3. **Skipped when `actor === assignee`** (self-assignment is silent — Admin self-assign included). Unassign (`assigneeId → null`) sends nothing. A→B reassign notifies **B only**.

Notification rows are written in the same DB transaction as the task mutation; the SSE publish happens **after commit** (a rolled-back transaction must never produce a live event).

## 6. SSE design (net-new — nothing exists in either app today)

- `@Sse('notifications/stream')` returning an `Observable<MessageEvent>`; guarded by `SessionAuthGuard + ActiveMemberGuard`; `@SkipThrottle()` (§3.2).
- **`NotificationEmitterService`**: in-process `Map<userId, Subject<MessageEvent>>` (multicast — multiple tabs share the user's subject) + a Redis **subscriber** connection (`redis.duplicate()`) using plain **`subscribe('nexus:notifications')`** — a single shared channel, so `psubscribe` (patterns) is unnecessary (review fix #6). Any process/cron instance publishes to the same channel and reaches every connected node.
- Wire format: `event: notification` / `data: { ...NotificationResponseDto }` JSON.
- **Heartbeat (review fix #5):** Nest's `MessageEvent` is `{ data, id?, type?, retry? }` — it has **no comment field**, so SSE `: ping` comments are not emittable through `@Sse`. Instead emit a **named event**: `{ type: 'ping', data: { ts: Date.now() } }` every **25 s**. Clients simply never subscribe to `ping` (browsers only deliver listened event names to handlers). Each heartbeat revalidates the session in Redis; session gone → emit `event: session_expired` + complete the subject (client tears down; EventSource retry gets 401 and the client stops reconnecting).
- Connection lifecycle: subscribe to the user's subject + Redis channel on connect; unsubscribe + complete on disconnect (RxJS cleanup). No replay on connect — the client fetches the REST list first and uses SSE purely as an append channel (dedupe by `id` covers the reconnect race).
- Frontend transport: native `EventSource(url, { withCredentials: true })` — CORS already allows credentials (`CORS_ORIGINS` must include the Vite origin); the httpOnly `nexus_sid` cookie rides along. EventSource auto-reconnects across server restarts; the client reconciles via REST `GET /notifications` on every `open` event.

## 7. Due-date reminder scheduler

- `@nestjs/schedule` (`ScheduleModule.forRoot()` in `app.module.ts`; **new dependency**) — cron **every 15 minutes** in `tasks.scheduler.ts`, guarded by a Redis `SETNX` lock (`nexus:tasks:reminder-lock`, **EX 600** — review fix #7: a TTL equal to the interval lets the next tick race a still-running job at expiry; 600 s < 900 s interval so a lock can never survive to the next tick. The lock is only an **optimization** — correctness comes from `ON CONFLICT DO NOTHING`, so the worst case after a crash is one skipped tick).
- Sweep query (reminder repository): tasks where `assigneeId IS NOT NULL AND dueDate IS NOT NULL AND status NOT IN ('done','resolved')` **and the assignee is still an ACTIVE project member** (review fix #9 backstop):

  ```sql
  EXISTS (SELECT 1 FROM project_members pm
          JOIN organization_members om ON om.id = pm.organization_member_id AND om.status = 'ACTIVE'
          WHERE pm.project_id = tasks.project_id AND pm.user_id = tasks.assignee_id)
  ```

  Windows, per task (UTC):
  - **`due_soon`** — `now` falls in the previous calendar day of `dueDate` (i.e. `dueDate - 1 day ≤ now < dueDate`) → insert with `dedupeKey = 'due_soon:<dueDate>'`;
  - **`due_today`** — `now ≥ dueDate 09:00` (and still on/before the due day) → insert `dedupeKey = 'due_today:<dueDate>'`.
- Insert with `ON CONFLICT (taskId, userId, dedupeKey) DO NOTHING`; **only a row actually inserted** is published to SSE (idempotent no matter how often the job runs or how many instances).
- Because `dedupeKey` embeds the date: **changing `dueDate` re-arms both windows** for the new date; old notifications persist as history. A reassigned task gets its **new** assignee's own reminders (keys are per-user). A task created inside a window (e.g. created 10:00 on the due date, `due_today` target) receives the reminder on the next sweep; a window that fully passed while the task was unassigned/`done` is simply skipped — no back-fill spam.
- Deliberately **no overdue nagging** beyond the two windows (confirmed scope). A task that slips past midnight of its due date gets no further reminders.
- Reminder row: `type='due_reminder'`, snapshot title "Task due soon" / "Task due today", body with key + title + due date.

## 8. Supporting backend changes

### 8.1 RedisModule — subscriber support

`RedisModule` currently exports a single ioredis client. The emitter needs a dedicated subscriber connection: export a **factory/provider** for `redis.duplicate()` (subscriber mode is connection-exclusive in ioredis — a normal client cannot `subscribe`). No other module changes.

### 8.2 Task sequence — `projects.taskCounter` (review fix #8)

`MAX(seq)+1` was rejected: deleting the highest task (e.g. `WR-4`) would reissue that key to the next creation while external references (notification snapshots, copied links) still point at the dead task — breaking the "immutable key" guarantee. Instead:

- `projects.taskCounter integer NOT NULL DEFAULT 0` (§2).
- Create transaction (under the same advisory project lock that serializes creators): `UPDATE projects SET taskCounter = taskCounter + 1 WHERE id = $projectId RETURNING taskCounter` → the returned value is `seq`. Monotonic, never reused, no gap-reuse hazard; `unique(projectId, seq)` remains as a backstop.
- The counter is never decremented and never rewritten; deleting tasks leaves gaps, which is correct.

### 8.3 Unassign on member removal (review fix #9)

A member removed from a project (or from the org) must not keep `assigneeId` — otherwise they keep receiving reminders for a task they can now only 404 on. Three layers, **no module cycles** (all are shared-schema Drizzle updates inside the *existing* removal transactions, per the `members-plan §5.3` precedent):

1. **Project path** — `projects.repository.removeMember` (`projects.repository.ts:277`, inside its existing per-project advisory-locked transaction): after the membership row delete, run
   `UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE project_id = $projectId AND assignee_id = $userId`.
2. **Org path** — `members.repository.removeMember` (`members.repository.ts:363`, inside its existing transaction): after the org-membership delete (whose FK cascade removes the `project_members` rows), run
   `UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE assignee_id = $userId`
   (singleton org — one statement covers all their projects). `MembersModule` must **not** import `TasksModule` (Tasks → Members for the guard would form a cycle), hence the direct schema access.
3. **User deletion** — the existing FK `ON DELETE SET NULL` on `tasks.assignee_id` fires (user row gone); their notifications cascade via the user FK.

Plus the **sweep backstop** (§7): even if some future removal path misses the hooks, no reminder is sent to someone without an ACTIVE project membership.

These unassign hooks land in the **tasks backend commit** (the `tasks` table must exist first); they touch `projects.repository.ts` / `members.repository.ts` and their specs.

### 8.4 Bootstrap fix (blocks typecheck today) + dependency

`Backend/src/app.module.ts` — TasksModule import `./tasks/tasks.module` → `./module/tasks/api/tasks.module` (scaffold moved, import didn't). Add `ScheduleModule.forRoot()`. Install `@nestjs/schedule`.

### 8.5 Out of scope (explicit)

Mail notifications for assignments/due dates · comments, mentions, attachments · subtasks/checklists · task ordering within a column (drag within a column is cosmetic) · recurring tasks · time tracking · "My tasks" full page (optional stretch) · notification types beyond the two live ones (schema supports them) · overdue reminders past the due-day window · editing `created_by` · project-scoped notification preferences.

## 9. Edge cases (acceptance checklist)

**Dates**

1. Create with due date = yesterday → **400 `due_date_past`**; = today → OK; = tomorrow → OK.
2. `PATCH` changing due date to a past day → **400**; changing to today/future → OK.
3. `PATCH` that resubmits the **stored** (now overdue) due date unchanged while editing the title → **allowed** (no-change exemption); submitting a *different* past date → 400.
4. Due date omitted / null → task has no due date; reminder sweep ignores it.
5. Due date malformed — `2026-13-40`, `2026-02-30`, `2026-11-05T10:00:00Z`, `null` where a value is expected → **400** from DTO validation (`@IsISO8601({strict})` catches impossible calendar dates, the regex rejects datetimes) — never a Postgres 500.
6. Clock/timezone: comparisons use the server's UTC date only — no client-tz guessing.

**Assignment**

7. Dev creates with `assigneeId` = someone else → **403 `role_forbidden`** (forced to self).
8. Dev creates with no assignee → **403** (a Dev's create *is* a self-assign).
9. PM assigns a **PM** target → **400 `assign_target_invalid`** (only Admin may target PMs).
10. Lead assigns a **PM** target → same 400. Admin assigns a **Dev, PM, or Admin** → OK.
11. Anyone assigns an **HR** user → **400**. Assignee not a member of the project → **400**.
12. Assign to a user with no/INVITED org membership → 400 (must be an ACTIVE project member).
13. Dev (even the assignee) calls `POST /assign` → **403**.
14. **Admin assigns to self** → 200, **no notification** (matrix §1.2 admits Admin targets; self-assign is silent for every role). Lead self-assign (as a Dev target) → same.
15. A→B reassign → notify B only; unassign → no notification; re-assign B→A after unassign → notify A again (dedupeKey is NULL — each change is a fresh row).
16. Assignee **removed from the project** → tasks unassigned inside the removal tx (§8.3.1); **removed from the org** → same (§8.3.2); **user account deleted** → FK SET NULL + notifications cascade (§8.3.3). In every case the sweep's ACTIVE-membership join (§7) independently blocks stray reminders.
17. Multiple tasks per developer → unrestricted (confirmed requirement).
18. Same-value assign (`assigneeId` unchanged) → 200 no-op, no lock, no notification.

**Permissions / visibility**

19. Non-member PM/Dev hitting any task route for a project they're not in → **404** (no existence leak).
20. HR `GET` board → 200; HR any mutation → **403 `role_forbidden`** (RolesGuard + service re-check; defense-in-depth behind the read-only UI).
21. Dev moves **someone else's** task status → **403**; moves **own** → 200.
22. Dev edits fields of own task → **403** (field edits are full-actors-only; assignee gets status-move only).
23. PM not a member of the project → 404 on all routes (invisible before policy).
24. Lead status is per-project and per-row — a Lead on project X has no powers on project Y (404/403 accordingly).
25. PM assigned-only-by-Admin is enforced at the **target** side of the matrix (rows 9–10), not as a special case on the PM's own routes.

**Lifecycle / races**

26. Concurrent creates on one project → advisory lock serializes the `taskCounter` increment; `unique(projectId, seq)` backstops; duplicate key → 409 retry.
27. Rapid drag status moves → last-write-wins; `updatedAt` reflects it.
28. Project deleted → tasks cascade → notifications cascade.
29. Task deleted → its notifications cascade; a user's open notification list may briefly show a row whose task is gone — clicking it → graceful "task no longer exists" toast on the frontend; list reconciles on next fetch.
30. User deleted → their notifications cascade; their assigned tasks become unassigned (FK SET NULL).
31. Org deleted → everything above cascades from the top.
32. **Delete the highest task (`WR-4`) → next create gets a fresh counter value (`WR-5`), never a reissued `WR-4`** (§8.2). Notification snapshots referencing the old `WR-4` can never collide with a live key.

**Reminders**

33. Task already `done`/`resolved` when a window opens → skipped; **reopened** inside the remaining window → next sweep sends it (no row was written while done).
34. Reminder for a task whose assignee changed after `due_soon` fired → old assignee keeps their history row; new assignee gets their own `due_soon`/`due_today` if still inside the window.
35. Due date edited → new dedupe keys → both windows re-arm for the new date; old rows remain as history (never deleted).
36. Cron runs twice concurrently (multi-instance / overlap) → Redis SETNX lock (600 s, §7) + `ON CONFLICT DO NOTHING` → exactly one row, one SSE event; even a lock expiry race collapses into the ON CONFLICT.
37. Unassigned task at window time → skipped; assigned later same day → `due_today` (if ≥09:00) or `due_soon` fires on next sweep per window rules — never both twice, never back-filled for missed past windows.
38. Assignee loses ACTIVE org status or project membership **between** windows → sweep join (§7) blocks the reminder even if the unassign hook were somehow missed.
39. Feature ships with existing overdue tasks → they cannot exist via the API (dates are validated); only clock-skew from manual DB edits could produce them, and they receive no spam.

**SSE / notifications**

40. Two tabs, one user → both receive the event (multicast subject).
41. Event lost mid-disconnect → reconnect + REST reconcile; client dedupes by `id`.
42. Session expires while the stream is open → heartbeat detects it → `session_expired` → close; client stops reconnecting and runs the existing 401 → `endSession` path.
43. Server restart → EventSource auto-reconnects; no missed notifications (persisted + reconcile on `open`).
44. Cross-origin Vite→API → `withCredentials: true` + CORS creds (already configured; verify `CORS_ORIGINS`).
45. EventSource reconnect storm → `@SkipThrottle()` on `/stream` prevents 429s; auth guards still apply per connection.
46. `PATCH /notifications/:id/read` on someone else's row → **404**. Already-read → 200 no-op.
47. `unreadCount` always derived from the DB (`readAt IS NULL`) — never a client tally.
48. Pagination: a burst of notifications between page fetches cannot skip/duplicate rows — the cursor compares `(createdAt, id)` at full microsecond precision inside Postgres (§3.2), and ties on `createdAt` are broken deterministically by `id`.
49. Heartbeat is delivered as a named `ping` event the client ignores — no reliance on SSE comments (not representable in Nest's `MessageEvent`).
50. Logout → client closes the stream, clears the notifications slice.
51. HR (read-only role) still receives their own notifications if somehow assigned — but the assignment matrix forbids HR targets, so only a future notification type could reach them; the SSE route itself only requires ACTIVE membership.

**Validation / hygiene**

52. Empty/whitespace title → 400 (`@Trim` + `@IsNotEmpty`).
53. Smuggled fields (`projectId`, `key`, `seq`, `taskCounter`, `createdByUserId`, `readAt`) stripped by the whitelist pipe.
54. Invalid uuid params → 400; unknown task/notification id → 404.
55. `PATCH {}` → **400 `empty_update`** (mirrors projects).
56. Task keys remain stable across project renames (stored at creation) and are never reissued after deletions (§8.2).
57. Notification `title`/`body` are snapshots — renaming or reassigning the task never mutates existing notification text.

## 10. Frontend plan (deliverable 2 — after the backend is pushed)

```
Frontend/src/
├── lib/api.ts                              [EDIT] Task / Notification types; listProjectTasks, createTask,
│                                               updateTask, changeTaskStatus, assignTask, deleteTask;
│                                               listNotifications (cursor = { createdAt, id }), markNotificationRead,
│                                               markAllNotificationsRead
├── lib/board.ts                            [EDIT] fromApiStatus/toApiStatus + fromApiPriority maps
│                                               ('in_progress' ⇄ 'progress', 'in_review' ⇄ 'review', 'on_hold' ⇄ 'hold');
│                                               keyPrefix() stays client-side display logic
├── lib/notificationsStream.ts               [NEW] EventSource singleton: start after authenticated, stop on logout,
│                                               reconnect + REST reconcile on open, dispatch to notificationsSlice;
│                                               listens only to 'notification' (server 'ping'/'session_expired' handled by name)
├── store/slices/notificationsSlice.ts       [NEW] { items, unreadCount, status }; SSE append (dedupe by id), read/read-all,
│                                               infinite scroll via nextCursor
├── store/index.ts                          [EDIT] register notifications slice
├── components/dashboard/TopBar.tsx          [EDIT] notification bell + dropdown panel: unread badge, list (icon/title/body/time),
│                                               mark one / mark all read, empty state; click → navigate to the task
├── components/dashboard/NotificationCenter.tsx [NEW] the dropdown panel component (keeps TopBar thin)
├── pages/ProjectBoardPage.tsx               [EDIT] replace seedTasks()/SEED with listProjectTasks(projectId);
│                                               moveTask → changeTaskStatus (optimistic + rollback on error);
│                                               dialog create/edit/delete/assign → API; real members replace DEMO_MEMBERS;
│                                               HR: locked screen → read-only board (mutations hidden, full=false);
│                                               honor ?task=<id> query param by opening the task dialog (notification deep link)
├── router.tsx                              [EDIT] no new routes required for the bell; optional /dashboard/tasks stretch
└── components/dashboard/Sidebar.tsx         [EDIT] (stretch only) "My tasks" placeholder → real page
```

Board wiring notes:

- The page keeps its local `useState` for tasks (drag performance) but **seeds from the API**; every mutation is optimistic with rollback via the existing toast path (`ApiError → toast`).
- Assignee options come from the real project roster; the UI only offers targets the server would accept (client mirror of `TasksPolicy.canAssignTarget` — Admin: Dev/PM/Admin targets; PM/Lead: Dev targets — server stays the authority).
- HR sees the board read-only: no "+ Add task", no drag, no dialog edit/delete — matching the API's 403s.
- Status/priority wire through the API enums (`in_progress` etc.); `lib/board.ts` owns the mapping so the UI's `StatusKey`s don't change.
- Notification click → `/dashboard/projects/:projectId/board?task=<taskId>`; the board opens that task's dialog (fetch via `GET /tasks/:id`, 404 → toast).

## 11. Delivery order

Internal build order (still one commit per side — §12):

1. **Backend, step 1** — schema: `tasks.ts`, `notifications.ts`, `projects.taskCounter` edit, exports → `npm run db:generate` / `npm run db:migrate`; `app.module.ts` import fix + `ScheduleModule.forRoot()` + install `@nestjs/schedule`. Typecheck.
2. **Backend, step 2** — notifications module: constants → repository (fixed-precision cursor) → emitter (Redis pub/sub + named-event heartbeat) → service → controller → DTOs → module. Specs: cursor pagination boundary, read/read-all, not-yours 404, emitter fan-out.
3. **Backend, step 3** — tasks module: constants → policy (§1.1–§1.2 matrices) → entities/factory → repository (counter-based advisory-locked create, assignee join) → DTOs + response mappers → service (incl. assignment notification side-effects) → controller → module rewrite. Specs: visibility matrix, mutation matrix, assignment matrix, due-date rules (past / no-change exemption / strict-calendar validation / null), Dev self-create forcing, assignee status-move only, self-assign silence, counter never reuses a deleted seq.
4. **Backend, step 4** — reminder scheduler + unassign hooks: `tasks.scheduler.ts` (600 s SETNX lock, ACTIVE-membership sweep join), unassign updates in `projects.repository.removeMember` + `members.repository.removeMember` + their specs. Specs: window boundaries (day-before, 09:00 due-day), done/resolved skip, dedupe re-arm on due-date change, ON CONFLICT idempotency, unassign on both removal paths.
5. **Backend, step 5** — full typecheck + lint; manual SSE smoke (two browsers, assign across users) — no e2e harness exists for streams; keep the emitter thin so unit specs stay meaningful. **Commit + push** (message §12).
6. **Frontend** — §10 order (api.ts → maps → slice → stream → bell → board wiring → HR read-only). Root `npm run lint` + `npm run typecheck` (Biome); both apps build. **Commit + push** (message §12).

## 12. Commit messages

Exactly two — one when the backend is complete, one when the frontend is complete:

```
feat(tasks): add project task board with notifications and due-date reminders
feat(frontend): wire task board and notification center to the api
```
