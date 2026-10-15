# Organization Module — Implementation Plan

Backend-only plan for the organization feature. Frontend and the members feature are explicitly out of scope for this pass.

## 1. Confirmed decisions

| Decision | Answer |
|---|---|
| Scope | System-wide **singleton** — only one organization may exist; create is rejected (409) until it is deleted |
| Mutate permission | **Owner PM, plus Admin break-glass**: `update/delete = (role === 'PM' && actor.userId === org.createdByUserId) || role === 'Admin'` — the Admin fallback prevents lock-out if the creator's account is deleted or demoted. Create remains PM-only |
| View permission | Any authenticated user (valid session cookie) |
| Fields | `name` + `slug` only (plus system columns) |
| Delete | Hard delete |
| Factory pattern | Builds the `Organization` domain entity from the create DTO + actor |
| Out of scope | Members, frontend |

Stack context: NestJS 11 + Drizzle ORM (PostgreSQL 17) + Redis-backed sessions, class-validator, roles `PM | Dev | Admin`. This module is the first protected API, so the session guard lands here.

## 2. Database

New Drizzle table in `Backend/src/module/database/schema/organizations.ts`, exported from `schema/index.ts`:

```ts
id              uuid PK default gen_random_uuid()
name            varchar(100) not null
slug            varchar(63) not null            // matches DTO bounds (3–63)
singleton       boolean not null default true   // UNIQUE + CHECK (singleton = true)
createdByUserId uuid not null → users.id (FK, restrict)
createdAt       timestamptz not null defaultNow()
updatedAt       timestamptz not null defaultNow()
```

- **Singleton enforcement lives in the DB, not only in app code.** The column carries both `UNIQUE` and `CHECK (singleton = true)` (Drizzle `check()` in the table config). The CHECK closes the `false`-row bypass — without it, one `true` row plus unlimited `false` rows would slip through; with it, every row must be `true`, and the UNIQUE then makes a second row impossible, even under concurrent requests. The repository catches Postgres error `23505` (unique violation) and maps it to `409 organization_exists`. No advisory locks needed.
- Index on `createdByUserId` — cheap, and ready for the future members feature.
- Migration: `npm run db:generate` produces `drizzle/0003_*.sql`; apply with `npm run db:migrate` against `POSTGRES_HOST_PORT` (never PgBouncer — transaction mode is unsafe for DDL).

## 3. Files — new / rewritten

```
Backend/src/
├── app.module.ts                                       [FIX] import → ./module/organization/api/organization.module
├── common/
│   ├── decorators/roles.decorator.ts                   [NEW] @Roles('PM') + export from index.ts
│   └── guards/roles.guard.ts                           [NEW] Reflector-based role attribute check
├── module/
│   ├── database/schema/organizations.ts                [NEW]
│   ├── database/schema/index.ts                        [EDIT] export organizations
│   ├── auth/api/
│   │   ├── auth.module.ts                              [EDIT] export SessionService + SessionAuthGuard
│   │   └── guards/session-auth.guard.ts                [NEW] cookie → SessionService.get → req.user; 401 otherwise
│   └── organization/
│       ├── docs/organization-plan.md                   [NEW] this document
│       └── api/
│           ├── constants/organization.constants.ts     [NEW] all error statuses + messages
│           ├── dto/create-organization.dto.ts          [REWRITE] name, slug (class-validator + Swagger)
│           ├── dto/update-organization.dto.ts          [REWRITE] both fields optional
│           ├── dto/organization-responses.dto.ts       [NEW] OrganizationResponseDto
│           ├── entities/organization.entity.ts         [REWRITE] props-object + getters (mirrors User entity)
│           ├── factories/organization.factory.ts       [NEW] create(dto, actorUserId) → Organization
│           ├── policies/organization.policy.ts         [NEW] ABAC: canManage(actor, org)
│           ├── repositories/organization.repository.ts [NEW] @Inject(DRIZZLE); singleton + CRUD
│           ├── organization.controller.ts              [REWRITE] singleton routes, guards, Swagger
│           ├── organization.service.ts                 [REWRITE] orchestration
│           ├── organization.module.ts                  [EDIT] import AuthModule; register factory/policy/repository
│           └── *.spec.ts                               [REWRITE] service + controller specs
```

Conventions to follow (from the auth/health modules): controller → service → repository with a domain entity layer between service and persistence; repositories are the only layer that touches SQL (`@Inject(DRIZZLE)`); `{ status, message }` error bodies from a `constants/` file; Swagger `@ApiProperty` on every DTO field; response DTOs so entities are never serialized directly.

## 4. Endpoints

Routes live under the global prefix at `/api/v1/organization`. No `:id` — the resource is a singleton.

| Route | Guards | Behavior |
|---|---|---|
| `POST /organization` | SessionAuthGuard → RolesGuard(`PM`) + `@Throttle(5/10min)` | Factory builds the entity → repository insert. **201** + `OrganizationResponseDto`. **409** `{ status: 'organization_exists' }` if a row already exists (also via `23505` catch for races) |
| `GET /organization` | SessionAuthGuard only | **200** `{ organization: OrganizationResponseDto \| null }` — a null body, not a 404, so the frontend can branch without error-driven UX (mirrors the `/auth/me` style) |
| `PATCH /organization` | SessionAuthGuard → RolesGuard(`PM`, `Admin`) | Load org (**404** `organization_not_found`) → policy `canManage` (**403** `not_organization_owner` for a non-owner PM) → **400** `empty_update` if no fields provided → update. **200** + DTO |
| `DELETE /organization` | SessionAuthGuard → RolesGuard(`PM`, `Admin`) | Same load + policy checks → hard delete → **204** No Content |

Create stays `@Roles('PM')` — the Admin break-glass covers update/delete only, not creation.

## 5. ABAC design

Implemented via a small policy consulted by the service, plus a role guard for the role attribute:

- **Subject attributes**: `role`, `userId` — taken from the Redis session snapshot (never from the request body).
- **Resource attributes**: `createdByUserId` — loaded once from the DB.
- **Actions**: `view` (any valid session), `create` (PM only), `update` / `delete` — `(PM ∧ owner) ∨ Admin`.
- **Admin break-glass** exists so the organization cannot be orphaned: if the creator's account is deleted or demoted, an Admin can still update or delete it. The role check uses the session snapshot — no extra query.
- **Residual risk (accepted)**: if the creator is gone and no Admin account exists, the org is unmodifiable until an Admin exists.
- Dev → **403** `pm_required` on create/update/delete; non-owner PM → **403** `not_organization_owner` on update/delete; both can still `GET`.

`organization.policy.ts` exposes `canManage(actor: SessionUser, org: Organization): boolean` — true for `role === 'Admin'`, true for a PM only when `actor.userId === org.createdByUserId`, false otherwise. `RolesGuard` (in `common/guards`, Reflector-based, reading `@Roles(...)`) enforces the role attribute on mutating routes; ownership is checked in the service after the single load, so the org row is never fetched twice.

`SessionAuthGuard` (in `auth/api/guards`): reads the `nexus_sid` cookie → `SessionService.get(sid)` → attaches `SessionUser` to `req.user`; missing/corrupt/expired session → **401** with `UNAUTHENTICATED_MESSAGE`. Applied on the organization controller only — not registered globally yet (the auth plan explicitly deferred a global guard; this stays scoped).

## 6. Factory pattern

`OrganizationFactory.create(dto: CreateOrganizationDto, actorUserId: string): Organization` is the single construction point:

- sets `id` (uuid),
- normalizes `slug` (trim + lowercase),
- stamps `createdAt = updatedAt = new Date()`,
- records `createdByUserId = actorUserId`.

Injectable provider, registered in the organization module. The repository keeps row↔entity mapping private (`toEntity`), matching `AuthRepository`. The factory is the seam for future variants (e.g. organization types) without changing callers.

## 7. Validation

- `name`: `@Trim @IsString @MinLength(2) @MaxLength(100)`
- `slug`: `@Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)` — same as the frontend `SLUG_PATTERN`, `@MinLength(3) @MaxLength(63)`, lowercase via transform. The schema column is `varchar(63)`, so DB and DTO bounds agree — no path exists for a >63-char slug to reach the database
- `PATCH`: same rules with everything `@IsOptional()`
- Empty PATCH after whitelist stripping: class-validator cannot express "at least one field" — the service checks `Object.keys(dto).length === 0` → 400 `empty_update`
- Unknown body fields are stripped by the global `ValidationPipe({ whitelist: true })`

## 8. Edge cases

| Case | Response |
|---|---|
| Second create (sequential) | 409 `organization_exists` |
| Two concurrent creates | One 201; the loser hits `23505` → 409 (race-safe) |
| Dev create/update/delete | 403 `pm_required` |
| Admin create | 403 `pm_required` (break-glass covers update/delete only) |
| Admin update/delete | Allowed regardless of ownership |
| Non-owner PM update/delete | 403 `not_organization_owner` |
| Creator deleted or demoted | Admin can still update/delete — no lock-out |
| Row inserted with `singleton = false` | Rejected by the CHECK constraint |
| Update/delete with no organization | 404 `organization_not_found` |
| Empty PATCH body | 400 `empty_update` |
| No / invalid / expired session cookie | 401 `unauthenticated` |
| Delete then re-create by a different PM | Allowed — the singleton slot is freed; the new org records the new creator |
| Slug uppercase / surrounding whitespace | Normalized (lowercase/trim); pattern failure → 400 |
| Unknown request body fields | Stripped by whitelist |
| Unverified user attempt | Not reachable — login already blocks unverified accounts, so any session implies a verified user |

## 9. N+1 and scalability

- Every path is a single-row query — at most **1 SELECT per request**; there are no relations to fan out on.
- Rule recorded for the future members feature: fetch members and their users with one `JOIN` / `IN` query, never per-row queries.
- No in-process state; the singleton guarantee is enforced by Postgres, so multiple instances stay correct.
- Create is additionally throttled (`5 / 10min`) because it is a write; GET relies on the global 100/60s limit.
- No queue needed — all operations are synchronous single-row reads/writes.

## 10. Error constants (organization.constants.ts)

| Status code (body) | HTTP | Message (draft) |
|---|---|---|
| `organization_exists` | 409 | An organization already exists. Delete it before creating a new one. |
| `organization_not_found` | 404 | Organization not found. |
| `not_organization_owner` | 403 | Only the organization owner can perform this action. |
| `pm_required` | 403 | Only a PM can perform this action. |
| `empty_update` | 400 | Provide at least one field to update. |
| `unauthenticated` | 401 | Reuses `UNAUTHENTICATED_MESSAGE` from auth |

## 11. Tests and verification

- `organization.service.spec.ts` — create success, 409 conflict mapping, owner-PM allowed, non-owner PM 403, Admin update/delete allowed regardless of ownership, Admin create → 403, 404 paths, empty-update 400, factory wiring (mock repository + policy).
- `organization.controller.spec.ts` — guard composition and status codes (mock service).
- Commands (from `Backend/`): `npm test`, `npm run typecheck`, `npm run lint`. Fixing the `app.module.ts` import also makes the repo typecheck again (lefthook hooks currently fail on it).

## 12. Implementation order

1. Fix the `app.module.ts` import → typecheck green baseline
2. Schema + export + `npm run db:generate` migration
3. Constants → entity → factory → repository
4. `SessionAuthGuard` + AuthModule exports; `@Roles` decorator + `RolesGuard`
5. Policy → service → DTOs/responses → controller → module wiring
6. Rewrite specs; run tests / typecheck / lint
7. Keep this plan doc in sync with any decisions that change during implementation

## 13. Assumptions

- Slug unique-index is skipped — irrelevant while only one row can exist; revisit with the members feature.
- The Admin break-glass is the accepted answer to the creator lock-out problem; the residual orphan case (creator gone, no Admin) is a known, accepted limitation for now.
- The singleton constraint is written in Drizzle as `check('organizations_singleton_check', sql`singleton = true`)` in the table config.
- `createdByUserId` is included in `OrganizationResponseDto` so the frontend can compare it against the session user to know who owns the org.
- No `session.touch()` sliding-expiry call in the guard; the auth controller handles session usage today.
