# Registration + Email Confirmation — Implementation Plan

**Status:** Approved for implementation (not yet implemented)
**Scope:** `register`, `verify-email`, `resend-confirmation` + session infrastructure (unused until login)
**Target:** `Backend/src/module/auth/api` (prepared folder), plus shared `redis`/`mail` modules

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Feature scope | `POST /auth/register`, `GET /auth/verify-email`, `POST /auth/resend-confirmation` only. **No session is created in this pass** (login is a later feature). |
| Sessions | Custom `SessionService` on ioredis — built and unit-tested now (create/get/touch/destroy + cookie helpers), no route uses it yet. |
| Roles | Enum validated server-side: `PM`, `Dev`, `Admin`. `Admin` is self-assignable (accepted risk; allowed list lives in one constant/env for easy tightening). |
| Password hashing | bcrypt, 12 rounds (env `BCRYPT_ROUNDS`). 8–72 chars (bcrypt silently truncates past 72 bytes). Policy: upper + lower + digit + symbol (`@IsStrongPassword`). |
| Validation | class-validator + class-transformer, global `ValidationPipe` (`whitelist`, `transform`), custom normalizer decorators (inline `@Transform` logic) on DTOs. |
| Mail | Nodemailer over SMTP, env-driven. |
| Queue | **BullMQ v6**, in-process Worker (closed on app shutdown, mirroring `PostgresPoolShutdown`). |
| Verification token | 32 random bytes, Redis with 24h TTL, one active token per user. |
| Idempotency | Natural + queue-level only (DB unique key, BullMQ dedup, idempotent verify). No `Idempotency-Key` header — rationale in §7. |
| Abuse control | `@nestjs/throttler` — global default + stricter per-route limits on register/resend. |
| N+1 policy | Explicit query budget + batch rules — §8. |
| Domain layer | Rich `User` entity with props-object public constructor + injectable `UserFactory.create()` (hash only, no re-normalizing); entity enforces rules (`markEmailVerified()`); repository constructs entities directly — §4. |
| Module layout | Stateful services under `src/module/*` (consistent with `module/database`); stateless shared code (decorators) under `src/common/*`. No `@Global()` for Redis/Mail — explicit imports. |

**Pattern:** layered controller → service → repository (matching the `health` module convention) with a domain entity layer between service and persistence (§4).

---

## 2. File tree

```
Backend/src/
├── app.module.ts                            (+ APP_PIPE ValidationPipe, ThrottlerModule, CORS)
├── common/
│   └── decorators/                          ← NEW (stateless, shared; logic inline in @Transform)
│       ├── trim.decorator.ts                @Trim
│       ├── normalize-name.decorator.ts      @NormalizeName (trim, collapse whitespace, strip control chars)
│       ├── normalize-email.decorator.ts     @NormalizeEmail (trim, lowercase, strip control chars)
│       └── index.ts                         single source of truth for data cleaning (DTO pipe only)
├── module/
│   ├── redis/                               ← NEW shared module (extracted from health)
│   │   ├── redis.module.ts                  REDIS_CLIENT provider (same options health uses today)
│   │   ├── constants/redis.constants.ts     REDIS_CLIENT token
│   │   └── redis.module.spec.ts
│   ├── health/                              (imports RedisModule; deletes its own client factory;
│   │                                        constants re-export or update imports in health + tracing)
│   ├── mail/                                ← NEW shared module (queue-centric)
│   │   ├── mail.module.ts                   Queue (producer) + Worker (consumer) + MailService;
│   │                                        worker.close() in OnModuleDestroy
│   │   ├── mail.queue.ts                    enqueueVerification(userId) — only method AuthService calls
│   │   ├── mail.service.ts                  SMTP send (used by the processor)
│   │   ├── processors/
│   │   │   └── send-verification.processor.ts
│   │   ├── templates/verify-email.ts        HTML + plain-text builder (no template engine)
│   │   ├── constants/mail.constants.ts      QUEUE_EMAIL, JOB_SEND_VERIFICATION, env keys,
│   │   │                                    MAIL_WORKER_CONCURRENCY=3
│   │   └── mail.service.spec.ts (+ processor spec)
│   ├── database/schema/users.ts             + role, password_hash, email_verified_at (stays the
│   │                                        persistence definition; entity sits above it)
│   └── auth/
│       ├── docs/register-auth-plan.md       (this file)
│       └── api/
│           ├── auth.module.ts               (+ DatabaseModule, RedisModule, MailModule, UserFactory)
│           ├── auth.controller.ts           routes below + Swagger decorators
│           ├── auth.service.ts              register / verify / resend orchestration
│           ├── auth.service.spec.ts
│           ├── auth.controller.spec.ts
│           ├── entities/
│           │   └── user.entity.ts           UserProps + User (props-object ctor, markEmailVerified, isVerified)
│           ├── factories/
│           │   ├── user.factory.ts          @Injectable UserFactory: async create(dto) — hash only
│           │   └── user.factory.spec.ts
│           ├── session/
│           │   ├── session.service.ts       create/get/touch/destroy + cookie helpers
│           │   ├── session.service.spec.ts
│           │   ├── session.constants.ts     key prefix, TTL, cookie name (env-driven)
│           │   └── session.types.ts
│           ├── repositories/
│           │   ├── auth.repository.ts       entity-aware: findByEmail/findById → new User({...}),
│           │   │                            insert/save(user) (drizzle)
│           │   └── auth.repository.spec.ts
│           ├── dto/
│           │   ├── register.dto.ts
│           │   ├── resend-confirmation.dto.ts
│           │   └── auth-responses.dto.ts    register/verify/resend response DTOs
│           └── constants/auth.constants.ts  verification TTL, ROLE list, message copies
Backend/drizzle/0001_*.sql                   drizzle-kit generate (role, password_hash, email_verified_at)
Backend/docker-compose.yml                    redis: allkeys-lru → volatile-lru (see §10)
Backend/.env + .env.example                   new mail/session/cors vars (see §11)
```

**Cleanup:** delete the empty scaffold `entities/auth.entity.ts` — `user.entity.ts` is the **only** entity (no `auth.entity`, no barrel/index for a one-file folder) — and delete `dto/update-auth.dto.ts`; drop the CRUD stubs (`findAll`/`findOne`/`update`/`remove`) from controller/service.

**Why not `common/` for redis/mail:** `common/` is stateless, cross-cutting code (its module is the `@Global()` observability module). Redis/mail are stateful service modules with connections, lifecycle and env config — same category as the existing `module/database`. No `@Global()` on them: explicit imports keep dependencies visible in tests and refactors.

---

## 3. API contract

All routes under the `/api/v1` global prefix.

### 3.1 `POST /auth/register`

Body: `{ name, email, password, role }`

- Pipe normalizes and validates (§5). Unknown fields silently stripped (`whitelist: true`).
- **Always `201` with an identical body** — `{"message": "If this email is available, a confirmation link has been sent."}` — prevents account enumeration. Internal branches:
  - **New user** → `factory.create(dto)` (bcrypt hash; DTO already normalized by pipe) → `repo.insert(user)` (returns entity with DB id, `emailVerifiedAt` unset) → generate token → write Redis token keys (`EX 24h`) → enqueue job → 201.
  - **Existing + unverified** → regenerate token (invalidates old) → overwrite Redis keys → enqueue → 201.
  - **Existing + verified** → send "you already have an account" notice (enqueue `account-exists` job or send inline) → 201.
- **Order is load-bearing:** token keys are written to Redis *before* enqueue — enqueue-first would race a worker that finds no token and skips.
- Enqueue failure (Redis down) is logged loudly but still returns 201: the account exists and the resend endpoint recovers.
- Postgres unique-violation race (`23505`) handled as the "existing" branch.

### 3.2 `GET /auth/verify-email?token=...`

- `GET auth:verify:<token>` → miss ⇒ `400 {"status":"invalid_or_expired"}`.
- Hit ⇒ `repo.findById(userId)` (constructs `User` directly) → **`user.markEmailVerified()`** → `repo.save(user)` → delete both Redis keys (token→user, user→token) → `200 {"status":"verified"}`.
- Already verified ⇒ idempotent `200` (entity's `markEmailVerified()` is a no-op when already set; service returns early via `user.isVerified`).
- **No session created** (per decision).
- Email link points to `${FRONTEND_URL}/verify-email?token=...` — the SPA page (future frontend work) calls this API; the API itself returns JSON.

### 3.3 `POST /auth/resend-confirmation`

Body: `{ email }` — normalized/validated identically to register. Throttled (3/10 min/IP). Always `202` with generic message. If account exists and is unverified → regenerate token + enqueue; otherwise no-op.

---

## 4. Domain layer — User entity & UserFactory

`entities/` holds exactly one file (`user.entity.ts`) — **no `auth.entity.ts`** (deleted as cleanup), no barrel. `factories/` holds the injectable factory.

### 4.1 `entities/user.entity.ts`

```ts
export interface UserProps {
  id?: number;
  name: string;
  email: string;
  role: Role;
  passwordHash: string;
  emailVerifiedAt?: Date | null;
  createdAt: Date;
}

export class User {
  constructor(private readonly props: UserProps) {}

  get id(): number | undefined { return this.props.id; }
  get name(): string { return this.props.name; }
  get email(): string { return this.props.email; }
  get role(): Role { return this.props.role; }
  get passwordHash(): string { return this.props.passwordHash; }
  get emailVerifiedAt(): Date | null { return this.props.emailVerifiedAt ?? null; }
  get createdAt(): Date { return this.props.createdAt; }

  get isVerified(): boolean {
    return this.props.emailVerifiedAt != null;
  }

  markEmailVerified(at: Date = new Date()): void {
    if (this.props.emailVerifiedAt == null) {
      this.props.emailVerifiedAt = at;
    }
  }
}
```

- **Props-object constructor** (labeled keys — no positional mix-ups, e.g. swapping `email`/`name`).
- `readonly props` freezes the reference, not the fields — `markEmailVerified()` mutates inside the class.
- The one domain rule of this feature — *"an account becomes verified exactly once, via its token"* — lives on the entity, not scattered in the service.
- The entity is **never serialized directly**; controllers return response DTOs (so `passwordHash` can't leak by accident).

### 4.2 `factories/user.factory.ts`

```ts
@Injectable()
export class UserFactory {
  constructor(@Inject(BCRYPT_ROUNDS) private readonly rounds: number) {}

  async create(dto: RegisterDto): Promise<User> {
    return new User({
      name: dto.name,        // pipe already normalized — factory does not re-clean
      email: dto.email,
      role: dto.role,
      passwordHash: await bcrypt.hash(dto.password, this.rounds),
      emailVerifiedAt: null,
      createdAt: new Date(),
    });
  }
}
```

- Injectable → `BCRYPT_ROUNDS` comes from env via a provider; bcrypt is mockable in unit tests.
- `create` is async (hashing) — its only real job.
- Does **not** re-normalize: the ValidationPipe + DTO decorators already did that (single source of truth, §5.2). The factory trusts its input — every real caller goes through the pipe.

### 4.3 Repository contract (entity-aware)

```ts
findByEmail(email: string): Promise<User | null>
findById(id: number): Promise<User | null>
insert(user: User): Promise<User>   // drizzle insert + returning → new User({ id: row.id, ... })
save(user: User): Promise<User>     // UPDATE derived from entity getters (e.g. emailVerifiedAt)
```

- Rows map to entities **directly in the repository** (`new User({ ..., passwordHash: row.password_hash, ... })`) — no `fromRow`/`restore` helpers.
- The drizzle schema (`database/schema/users.ts`) stays the persistence definition; the entity sits *above* it and does not import drizzle.
- All methods single-statement (§8 N+1 rules apply unchanged).

### 4.4 Flows with entity/factory

| Flow | Responsibility split |
|---|---|
| register | service orchestrates → `factory.create(dto)` → `repo.insert(user)` → token → enqueue |
| verify | `repo.findById` (constructs `User`) → **`user.markEmailVerified()`** → `repo.save(user)` → delete Redis keys |
| resend | unchanged (no entity construction; lookup + token regen + enqueue) |
| worker | unchanged (light projection or `repo.findById`) |

**Wiring:** `AuthModule` providers += `UserFactory` (with a `BCRYPT_ROUNDS` provider reading env).

**Tests added:** `user.entity.spec.ts` (`markEmailVerified` once / no-op when already verified / `isVerified`), `user.factory.spec.ts` (mocked bcrypt — called with configured rounds; constructs with DTO values; no `id` before insert; no re-normalization), `auth.repository.spec.ts` updated to entity-in/entity-out.

---

## 5. Validators & normalizers

### 5.1 Global pipe

Registered via `APP_PIPE` in `AppModule`:

```ts
new ValidationPipe({ whitelist: true, transform: true })
```

- Unknown fields stripped (frontends may send `terms`, etc.).
- **Implicit conversion off** — non-string JSON types fail `@IsString` instead of being coerced.
- Swagger picks up validation metadata automatically.

### 5.2 Normalizer decorators

Logic lives **inline in the decorators** (`src/common/decorators/`) — no separate `normalizers/` folder. The DTO pipe is the **single source of truth** for data cleaning; the factory never re-normalizes (§4.2).

| Decorator | Behavior |
|---|---|
| `@Trim` | `value.trim()` (no-op for non-strings) |
| `@NormalizeName` | trim → collapse internal whitespace (`/\s+/g` → single space) → strip control chars (`\p{Cc}`, incl. newlines) |
| `@NormalizeEmail` | trim → lowercase local + domain → strip control chars |

Accepted tradeoff: `factory.create()` only produces clean users when fed a validated DTO (every real HTTP caller does). A seed script or test calling it with raw strings must pass cleaned data itself.

### 5.3 Field rules (pipe order)

**`RegisterDto`** (all required, all `@ApiProperty`):

| Field | Decorators |
|---|---|
| `name` | `@IsString` `@Trim` `@NormalizeName` `@MinLength(2)` `@MaxLength(100)` `@Matches(/\p{L}/u)` (≥1 letter; blocks `"123"`, `"@#$"`) |
| `email` | `@IsString` `@NormalizeEmail` `@IsEmail({}, { message: 'Enter a valid email address' })` `@MaxLength(254)` (RFC cap; column is 255) |
| `password` | `@IsString` `@MinLength(8)` `@MaxLength(72)` `@IsStrongPassword({ minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 }, { message: 'Password needs 8+ characters with upper, lower, number and symbol' })` |
| `role` | `@IsString` `@IsIn(ROLES)` — `ROLES = ['PM','Dev','Admin']` exported from `auth.constants.ts`, single source for DTO + docs |

**`ResendConfirmationDto`:** `email` exactly as above.

⚠️ **Frontend mismatch (flagged, out of scope):** `SignupPage.tsx` currently enforces length ≥ 8 only. Once wired, weak passwords get 400s; the backend is authoritative. Frontend validation update is a follow-up task.

---

## 6. Queue design (BullMQ)

**Deps:** `bullmq@^6` (peer `ioredis >= 5` — repo's v6 satisfies it). BullMQ creates its own Redis clients from `{ host: REDIS_HOST, port: REDIS_PORT }`; we do **not** pass the shared `REDIS_CLIENT`.

**Job:** `send-verification` on queue `email`, payload `{ userId: number }` — no PII, no tokens in queue data (token stays in Redis).

```ts
queue.add(JOB_SEND_VERIFICATION, { userId }, {
  deduplication: { id: `verify:${userId}`, keepLastIfActive: true },
  attempts: 5,
  backoff: { type: 'exponential', delay: 3_000 },
  removeOnComplete: { age: 3_600, count: 100 },
  removeOnFail:    { age: 86_400 },
});
```

**Why this shape:**

- `deduplication.id = verify:<userId>` → at most one pending verification job per user; double-submits and resend bursts collapse into one.
- `keepLastIfActive: true` → if a token is regenerated while the worker is mid-send, the newest job is stored and runs right after — **the latest token always wins**, no resend silently lost.
- Payload is only `userId`, so a deduped/ignored add loses nothing: the processor re-reads fresh state.

**Processor (`send-verification.processor.ts`) logic:**

1. `GET auth:verify:uid:<userId>` → token; `findById` user (entity). If user verified/missing **or token gone (expired/consumed)** → complete as **skipped**, not failed (no wasted SMTP call, no retry storm; also handles verify-then-worker race).
2. Build link `${FRONTEND_URL}/verify-email?token=...`, send via `MailService`.
3. Error classification: SMTP 4xx/timeouts → `throw` (retries ×5, exponential); SMTP 5xx/permanent → BullMQ `UnrecoverableError` (stops immediately).
4. Token is never logged; failures logged via `AppLogger`.
5. After final failure: job retained 24h in `failed` for inspection; user remedy is the throttled resend endpoint.

**Lifecycle:** Worker created in the `MailModule` factory (starts immediately), closed via `OnModuleDestroy` (`await worker.close()`), same pattern as `PostgresPoolShutdown`. Concurrency: `MAIL_WORKER_CONCURRENCY` (default 3).

**Deferred (documented, not built):** separate worker process, queue-based non-verification mails, queue metrics/dashboard.

---

## 7. Idempotency analysis

| Risk | Mechanism | Result |
|---|---|---|
| Client retries `POST /register` | `users.email` unique index → `23505` handled as "existing" branch, identical 201 body | no duplicate user, same response |
| Double-click verify link | token key deleted on consume; already-verified → idempotent 200 | no double side effects |
| Email bursts (retry/resend storms) | BullMQ dedup + `keepLastIfActive` + throttler (register 5/10 min, resend 3/10 min) | ≤1 active + ≤1 pending job per user |
| Stale token sent after resend | processor re-fetches **current** token at execution time | dead links minimized |
| Duplicate send after mid-send retry | at-least-once → worst case one extra email with a still-valid link | accepted, documented |
| SMTP transient failure | 5 attempts, exponential backoff; `UnrecoverableError` for 5xx | retry without hammering |
| Worker finds consumed/expired token | skip-completion, not failure | verify-then-worker race safe |

**Why no `Idempotency-Key` header:** every real duplicate risk above is already closed by DB constraints, queue dedup and the idempotent verify. A header would add request-hash storage/replay machinery (24h Redis records, 409 on mismatch) without fixing anything in this table. Revisit only if a non-idempotent, side-effect-heavy endpoint appears later.

---

## 8. Query budget & N+1 policy

### 8.1 Per-request budget (this feature) — no N+1 by construction

| Flow | Postgres | Redis | BullMQ |
|---|---|---|---|
| `POST /register` | 1× `SELECT … WHERE email=` (unique index) + 1× `INSERT` | 2× `SET` (pipelined) | 1× `add` |
| `GET /verify-email` | 1× `SELECT` by PK + 1× `UPDATE` | 2× `GET`/`DEL` | — |
| `POST /resend-confirmation` | 1× `SELECT` by email | 2× `SET`/`DEL` | 1× `add` |
| Worker (`send-verification`) | 1× `SELECT` by PK | 1× `GET` | — |
| `SessionService` (future use) | 0 (snapshot, §8.2) | 1× `GET` | — |

The register → token → enqueue sequence is sequential *by design* (race safety), but each step is O(1) — sequential ≠ N+1. Entity/factory add **zero** extra queries (mapping is in-memory).

### 8.2 Rules baked into the design

- **Single-column `role`** on `users` — deliberately not a `user_roles` join table; nothing to loop over or eager-load later.
- **Repository methods are single-statement:** any future method fetching "by a list of ids" must use `WHERE id = ANY(...)` / drizzle `inArray(...)` — never a loop of selects. Acceptance criterion when reviewing `auth.repository.ts`.
- **Redis multi-key reads** use `mget`/pipelining, never a loop of `get`.
- **`SessionService` stores a small user snapshot** (`userId`, `role`, `name`, `email`) in the session JSON → future `GET /auth/me` = 1 Redis read, **0 Postgres queries** (PK lookup only when fresh data is genuinely required).
- **Future list endpoints** (admin user listing, etc.): mandatory pagination (hard `LIMIT` max) + batch joins in one statement — flagged "must-not-regress" even though none exist in this pass.
- **Index rule:** every new query pattern in a PR must land with its index (email = unique constraint, id = PK today; lookups by `role`/`email_verified_at` would need a new index in the same PR).

---

## 9. Security pass

- **Privilege escalation:** role whitelist-validated; `Admin` self-assignable (accepted). Allowed list is one constant/env (`ROLES` / optional `REGISTRATION_ROLES`) → restricting to `PM,Dev` later is a one-line change.
- **Account enumeration:** identical responses on register/resend regardless of state; "already registered" delivered as an email to the owner, never in the API response.
- **Email bombing / abuse:** global throttler (e.g. 100 req/60 s/IP) + `@Throttle` overrides: register 5/10 min, resend 3/10 min.
- **Credential handling:** bcrypt only, hashed inside `UserFactory.create()`; `passwordHash` never in responses/logs (entity is never serialized directly — controllers return response DTOs); tokens never logged (also not in queue payloads).
- **Validation:** server-authoritative; bounds enforced even though the UI validates; control characters stripped from name/email (log-injection hygiene).
- **Errors:** standard Nest error payloads; no stack traces, DB schema or internal IDs leaked.
- **Session cookies (for future login):** `httpOnly`, `sameSite=lax`, `secure` env-driven, `path=/`.
- **CORS:** `enableCors({ origin: CORS_ORIGINS, credentials: true })` — required for the Vite frontend (:5173) to call the API at all.
- **Dependency additions (flagged for review):** `class-validator`, `class-transformer`, `bcrypt` (+ `@types/bcrypt`), `nodemailer` (+ `@types/nodemailer`), `@nestjs/throttler`, `bullmq`.

---

## 10. Scalability / ops

- **Stateless app + Redis sessions** → multi-instance safe. ⚠️ **docker-compose Redis runs `allkeys-lru` — change to `volatile-lru`**: with BullMQ in the mix, LRU must never evict queue keys; `volatile-lru` only evicts TTL'd keys (sessions/verification tokens — recoverable) and protects queue integrity.
- **In-process worker** shares the event loop; concurrency capped at 3. Extractable to a separate process later without code changes (processor already isolated).
- **Queue lifetime decision:** BullMQ chosen because the user requested it; SMTP retries/backoff/dedup are exactly its strengths. (Without that directive this volume would not have justified a queue.)
- **Email failure & `23505` race** both handled; no unbounded queries (email lookups use the unique index; see §8).
- **Mail is injectable** (`MailService`) — swapping SMTP → Resend or a dev stub touches one file.
- **Observability:** flows run through the existing `AppLogger` + tracing interceptor; Redis usage shows up in the existing dependency waterfall/metrics automatically.

---

## 11. Env additions (`.env` / `.env.example`)

```bash
# --- Mail (SMTP) ---
MAIL_SMTP_HOST=
MAIL_SMTP_PORT=587
MAIL_SMTP_SECURE=false
MAIL_SMTP_USER=
MAIL_SMTP_PASS=
MAIL_FROM_EMAIL=
MAIL_FROM_NAME=Nexus
MAIL_WORKER_CONCURRENCY=3

# --- Links (verification link base) ---
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173

# --- Verification ---
VERIFICATION_TOKEN_TTL_HOURS=24

# --- Auth ---
BCRYPT_ROUNDS=12

# --- Sessions (inert until login feature) ---
SESSION_COOKIE_NAME=nexus_sid
SESSION_TTL_SECONDS=604800
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAME_SITE=lax
```

---

## 12. Build order (execution steps)

1. ~~Write this plan to `auth/docs/`~~ ✔ this file.
2. Install deps: `class-validator class-transformer bcrypt nodemailer @nestjs/throttler bullmq` + dev `@types/bcrypt @types/nodemailer`; verify Nest 11 compatibility of `@nestjs/throttler`.
3. Extract shared `RedisModule`; refactor `health` + `tracing` imports off `health.constants`.
4. Schema: add `role`, `password_hash`, `email_verified_at` to `users` → `drizzle-kit generate` → `db:migrate`.
5. Normalizer decorators (inline `@Transform` logic) in `common/decorators/` + global `ValidationPipe` (`APP_PIPE`) in `AppModule`.
6. Domain layer: `entities/user.entity.ts` (props-object ctor), `factories/user.factory.ts` (async `create`, bcrypt rounds injected) — delete the `entities/auth.entity.ts` scaffold; entity-aware `auth.repository` (`findByEmail`/`findById`/`insert`/`save`, constructs `new User({...})` directly).
7. `MailModule`: SMTP transport + template + `MailQueue` producer + `SendVerificationProcessor` (lifecycle hooks, concurrency 3, dedup config from §6).
8. Auth: DTOs (§5) → service (§3 flows, §4.4 responsibility split) → controller (Swagger annotations).
9. `SessionService` scaffold (built + unit-tested, unused by routes).
10. Throttler (global guard + `@Throttle` overrides), CORS, compose Redis policy `volatile-lru`, env updates (§11).
11. Tests: normalizer decorators, `user.entity`, `user.factory` (mocked bcrypt — rounds, constructs from DTO, no re-normalization), `auth.service` (factory/repo/mail/queue mocked), `auth.controller`, `session.service` (mocked redis), `auth.repository` (entity in/out), `send-verification.processor` (send vs skip vs `UnrecoverableError`). Then `npm run lint`, `npm run typecheck`, `npm run test`.
12. Manual smoke: curl register → confirm job processed (logs) → mail received (Mailpit as optional compose service, or a real SMTP catcher).

---

## 13. Explicitly out of scope (follow-ups)

- `login` / `logout` / `me` endpoints (SessionService is ready for them).
- Frontend wiring: `SignupPage` → `POST /auth/register`, `/verify-email` SPA page, password-policy client-side update.
- Rate-limit tuning, admin role restriction, `Idempotency-Key` header.
- Separate worker process, queue dashboard, non-verification mail templates.
