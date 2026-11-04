# Nexus

**A team work-management platform** — organize your team's work with projects, kanban boards, documents, and real-time notifications.

Nexus gives a single organization everything it needs to run day-to-day work: invite members with role-based access, spin up projects with dedicated leads, track tasks across a seven-column kanban board, share project documents, and stay on top of deadlines with live in-app notifications.

---

## Features

### 🔐 Authentication & Security
- Email + password registration with email verification (token via Redis)
- Redis-backed session cookies with device list, per-device revoke, and logout-all
- Login lockout, rate limiting, enumeration-safe flows, timing-equalized credential checks

### 🏢 Organization & Members
- Singleton organization managed by Admins
- Role-based access: **Admin · HR · PM · Dev**
- Invite members by email with accept-invite flow (preview, resend, role assignment)
- Guard rails: no self-role-change, no self-removal, ≥1 active Admin invariant

### 📁 Projects
- CRUD with members and **team leads** (≥1 lead invariant, advisory-locked)
- Project-level permission policies layered on top of global roles

### 📋 Kanban Board
- 7 statuses: `todo → in_progress → in_review → on_hold → testing → resolved → done`
- 4 priorities: `urgent · high · medium · low`
- Drag-and-drop with edge auto-scroll and optimistic updates
- Immutable task keys (e.g. `WR-4`), assignees, due-date validation

### ✅ My Tasks
- List and calendar views
- Group by due date or project, priority buckets, overdue danger bucket

### 📎 Documents
- Upload / download / delete per project
- 25 MB limit, MIME allowlist + magic-byte sniffing, sanitized filenames
- Storage drivers: **MinIO** (default), **Amazon S3**, or **local disk**

### 🔔 Real-Time Notifications
- SSE stream (`EventSource`) for `task_assigned` and `due_reminder` events
- Cursor-paginated REST list, read/unread, mark-all-read
- Cron scheduler (every 15 min) for day-before and same-day due reminders (Redis-locked, idempotent)

### 📊 Observability
- `GET /api/v1/health` — Postgres / Redis / MinIO probes
- `GET /api/v1/metrics` — live p50/p95/p99 latencies, memory, CPU, event-loop lag
- Request-ID middleware, HTTP tracing with per-dependency waterfalls, structured colored logging

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19 · Vite 8 · TypeScript 6 · React Router 8 · Redux Toolkit · Tailwind CSS v4 · shadcn/ui · Radix UI · Lucide |
| **Backend** | NestJS 11 · TypeScript · Drizzle ORM · BullMQ · @nestjs/schedule · class-validator · Swagger |
| **Database** | PostgreSQL 17 + PgBouncer (transaction pooling) |
| **Cache / Sessions** | Redis 8 (sessions, lockout, tokens, queues, SSE pub/sub, scheduler locks) |
| **Object Storage** | MinIO / S3 / local disk |
| **Email** | BullMQ queue → SMTP (nodemailer) or Resend |
| **Tooling** | Biome (lint + format) · Lefthook · Commitlint (Conventional Commits) · Jest |

---

## Monorepo Layout

```
Nexus/
├── Frontend/          # React 19 + Vite SPA
│   └── src/
│       ├── pages/           # 13 route pages (auth, dashboard, board, tasks, profile…)
│       ├── components/      # auth guards, app shell, dashboard, dialogs, graphs, ui
│       ├── lib/             # API layer + domain modules (board, myTasks, documents…)
│       ├── store/           # Redux Toolkit: auth, org, members, projects, notifications
│       └── router.tsx       # createBrowserRouter
├── Backend/           # NestJS 11 REST API
│   ├── docker-compose.yml   # postgres, pgbouncer, redis, minio, redis-commander
│   ├── drizzle/             # generated SQL migrations
│   ├── scripts/seed-admin.ts
│   └── src/
│       ├── common/          # logger, tracing, metrics, guards, swagger
│       └── module/          # auth, organization, members, projects, tasks,
│                            # notifications, documents, storage, mail, redis, health
├── biome.json         # formatter + linter config
├── lefthook.yml       # pre-commit / commit-msg / pre-push hooks
└── package.json       # root orchestration scripts
```

> **Note:** this is not npm workspaces — `Frontend/` and `Backend/` are independent packages with their own lockfiles. The root package only holds shared lint/commit tooling.

---

## Prerequisites

- **Node.js** 20+ and npm
- **Docker** & Docker Compose (Postgres, Redis, MinIO)

---

## Quick Start

### 1. Install root tooling (git hooks)

```bash
npm install        # runs `prepare` → lefthook install
```

### 2. Start infrastructure

```bash
cd Backend
cp .env.example .env
docker compose up -d
```

This brings up **PostgreSQL 17** (host port `5433`), **PgBouncer** (`6432`), **Redis 8** (`6379`), **MinIO** (`9000`/`9001`), and **Redis Commander** (`8081`), gated by a health-check `ready` container.

### 3. Migrate the database & seed an admin

```bash
cd Backend
npm install
npm run db:migrate       # or: npm run db:push
npm run seed:admin       # uses SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
```

### 4. Run the backend

```bash
cd Backend
npm run start:dev        # → http://localhost:3000/api/v1
```

- Swagger UI: **http://localhost:3000/api-docs**
- Health: **http://localhost:3000/api/v1/health**
- Metrics: **http://localhost:3000/api/v1/metrics**

### 5. Run the frontend

```bash
cd Frontend
cp .env.example .env
npm install
npm run dev              # → http://localhost:5173
```

Sign in with the seeded admin credentials, create your organization, invite members, and start a project.

---

## Environment Variables

Both packages ship fully-commented `.env.example` files:

| File | Key variables |
|---|---|
| `Frontend/.env.example` | `VITE_API_URL` (default `http://localhost:3000/api/v1`) |
| `Backend/.env.example` | App, Postgres, PgBouncer, Redis, storage (`STORAGE_DRIVER`, MinIO/S3), observability, Swagger, mail (`MAIL_PROVIDER`, SMTP/Resend), CORS, sessions, login lockout, admin seed |

Copy each to `.env` and adjust as needed — both `.env` files are gitignored.

---

## Scripts

### Root

| Command | Description |
|---|---|
| `npm run typecheck` | Typecheck both packages |
| `npm run lint` / `lint:fix` | Biome check / auto-fix |
| `npm run format` / `format:check` | Biome format |

### Frontend

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | `tsc -b && vite build` |
| `npm run typecheck` | `tsc -b` |
| `npm run preview` | Preview production build |

### Backend

| Command | Description |
|---|---|
| `npm run start:dev` | Watch mode (port 3000) |
| `npm run build` / `start:prod` | Build / run compiled output |
| `npm test` | Jest unit tests (54 spec files) |
| `npm run test:cov` | Coverage report |
| `npm run test:e2e` | End-to-end tests |
| `npm run seed:admin` | Idempotent admin seed |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly |
| `npm run db:studio` | Drizzle Studio |
| `npm run profile` | CPU profile the server |

### Git Hooks (Lefthook)

- **pre-commit** — typecheck Frontend + Backend, Biome on staged files
- **commit-msg** — commitlint (Conventional Commits)
- **pre-push** — typecheck both packages

---

## Architecture

### Frontend

- **State:** Redux Toolkit with 5 slices (`auth`, `org`, `members`, `projects`, `notifications`), hand-rolled async thunks, `unknown | loading | ready | error` status machines, and cached fetches. Typed hooks via `useDispatch.withTypes()` / `useSelector.withTypes()`.
- **Routing:** `createBrowserRouter` with a pathless `ProgressLayout` (top loading bar) and a `RequireAuth` guard that trusts the server (`/auth/me`) as the source of truth. Login is the index route.
- **API layer:** single `lib/api.ts` fetch wrapper — `credentials: 'include'`, typed `ApiError`, request tracking for the loading bar; domain logic split into `lib/board.ts`, `lib/myTasks.ts`, `lib/documents.ts`, etc.
- **Session bootstrap:** `SessionGate` runs `/auth/me` once per page load (8s timeout, three-way verdict); `NotificationsStreamGate` opens the SSE stream when authenticated.
- **Live updates:** native `EventSource` on `GET /notifications/stream`; REST list remains the source of truth, SSE appends, reconnect reconciles.
- **Design:** Tailwind v4 `@theme` tokens (cobalt `#1f2fe0`, sun, ink, paper, mist), Figtree + Bricolage Grotesque type, shadcn/ui (radix-nova) + lucide icons.

### Backend

- **Module convention:** every feature lives in `src/module/<name>/api/` (controller, service, DTOs, entities, factories, **policies**, repositories, guards) with `docs/` implementation plans alongside.
- **Global prefix:** `api/v1`; Swagger at `/api-docs`.
- **Defense-in-depth guards:** `SessionAuthGuard` (Redis cookie → `req.user`) → `@Roles(...)` + `RolesGuard` → `ActiveMemberGuard` (fresh membership read); policies re-check inside services.
- **Validation:** global `ValidationPipe({ whitelist: true, transform: true })` + throttling (100 req/min default; stricter on register/resend).
- **Database:** Postgres behind PgBouncer; Drizzle schema with 8 tables — `users`, `organizations`, `organization_members`, `projects`, `project_members`, `tasks`, `notifications`, `documents`.
- **Sessions:** Redis (`nexus_sid` httpOnly cookie) with user snapshot for zero-Postgres `/auth/me`, per-user sorted set of live sessions for device management.
- **Queues:** BullMQ `email` queue (verification, account-exists, invite) with pluggable SMTP/Resend transports.
- **Scheduler:** `*/15 * * * *` reminder sweep with Redis `SET NX EX` lock + `ON CONFLICT DO NOTHING` idempotency.
- **Storage:** driver-agnostic `StorageService` with presigned GET URLs (5-min TTL); `/uploads` is never served statically.

---

## API Surface

Base URL: `http://localhost:3000/api/v1` — full interactive docs at **`/api-docs`**.

| Area | Endpoints |
|---|---|
| **Auth** | `POST /auth/register` · `GET /auth/verify-email` · `POST /auth/resend-confirmation` · `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `GET /auth/sessions` · `DELETE /auth/sessions/:publicId` |
| **Organization** | `GET/PATCH/POST/DELETE /organization` (mutations Admin-only, singleton) |
| **Members** | `GET /members` · `POST /members/invites` · `POST /members/invites/:id/resend` · `PATCH /members/:id/role` · `DELETE /members/:id` · `GET /members/invites/:token` · `POST /members/invites/:token/accept` |
| **Projects** | `POST/GET /projects` · `GET/PATCH/DELETE /projects/:id` · `POST /projects/:id/members` · `DELETE /projects/:id/members/:userId` · `PATCH /projects/:id/members/:userId/lead` |
| **Tasks** | `POST/GET /projects/:projectId/tasks` · `GET/PATCH /tasks/:taskId` · `PATCH /tasks/:taskId/status` · `POST /tasks/:taskId/assign` · `DELETE /tasks/:taskId` |
| **Documents** | `GET/POST /projects/:projectId/documents` · `GET .../:documentId/download` · `DELETE .../:documentId` |
| **Notifications** | `GET /notifications` (cursor) · `PATCH /notifications/:id/read` · `POST /notifications/read-all` · `GET /notifications/stream` (SSE) |
| **Ops** | `GET /health` · `GET /metrics` |

**App-level error codes** are returned as `{ "status": "code", "message" }` — e.g. `role_forbidden`, `last_lead_required`, `due_date_past`, `not_active_member`.

---

## Roles & Permissions

| Role | Capabilities |
|---|---|
| **Admin** | Full org + project control, break-glass operations |
| **HR** | Read-only oversight, people operations |
| **PM** | Creates and manages projects |
| **Dev** | Works on assigned tasks; can be flagged as project **Lead** |

Invariants: ≥1 active Admin · ≥1 lead per project · no self-service role change or self-removal · registration defaults to `PM`.

---

## Testing & Code Quality

- **Unit tests:** Jest 30 + ts-jest — 54 spec files covering controllers, services, policies, repositories, factories, guards, DTOs, logger, metrics, tracing, storage, and scheduler (`npm test`)
- **E2E:** health endpoint with mocked dependencies (`npm run test:e2e`)
- **Coverage:** `npm run test:cov`
- **Lint/format:** Biome 2.5.15 (recommended rules, single quotes, 80 cols, 2-space indent)
- **Typecheck:** enforced on both commit and push via Lefthook
- **Commits:** Conventional Commits enforced by commitlint

---

## Observability

- **Logging:** colored `AppLogger` with optional JSON output (`LOG_JSON`)
- **Tracing:** `HttpTracingInterceptor` emits per-request waterfalls with dependency spans (postgres / redis / minio), echoed `x-request-id`
- **Metrics:** live snapshot at `GET /api/v1/metrics` — p50/p95/p99 per route and dependency, memory/CPU, event-loop lag; periodic summary at `METRICS_INTERVAL_MS`
- **Latency thresholds:** color-coded warnings at `LATENCY_WARN_MS` / `LATENCY_ERROR_MS`
- **Profiling:** `npm run profile` (CPU profile via `--cpu-prof`)

---

## License

UNLICENSED (private).
