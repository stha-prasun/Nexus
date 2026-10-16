# Plan — Admin-managed organization (roles: Admin, HR, PM, Dev)

Status: **planned, not implemented.**

## 1. Goal

Change who owns the organization and which roles exist:

- **Admin** is the only role that can **create, edit, or delete** the organization.
- **HR** is added as a new role (invited/self-selected later; management of members is out of scope for now).
- **PM** stays a regular role — it loses every organization-management right it has today (create, owner-edit, owner-delete).
- **Dev** stays a read-only role for organization routes.
- Admin accounts are **seeded later** (seed script out of scope); Admin is removed from the open signup role picker so nobody self-registers as Admin.
- Everything else (singleton organization, sessions, auth, projects) is unchanged.

Explicitly **out of scope** for this change:

- Invitations / invite links / invite emails.
- Member listing, member removal, member role changes.
- Multi-organization support (the DB singleton constraint stays).
- The Admin seed script itself.

## 2. Decisions

| Topic | Decision |
|---|---|
| Organization model | Stays a singleton — only the allowed actor changes |
| Org create/edit/delete | `Admin` only |
| Org read (`GET /organization`) | Any signed-in user (unchanged) |
| Roles | `PM`, `Dev`, `Admin`, `HR` (HR appended — PG enums are append-only) |
| Signup role picker | `PM`, `Dev`, `HR` — `Admin` removed (seeded later) |
| PM | Regular role, no org-management rights |
| Session snapshot | Unchanged shape (`userId, role, name, email`) — no org id needed while singleton |

## 3. Current state (baseline)

- `Backend/src/module/auth/api/constants/auth.constants.ts:2` — `ROLES = ['PM', 'Dev', 'Admin']`.
- `Backend/src/module/database/schema/users.ts:22` — `roleEnum` derived from `ROLES`; default `'PM'`.
- `Backend/src/module/database/schema/organizations.ts` — singleton (`singleton` UNIQUE + CHECK), `createdByUserId` FK.
- `Backend/src/module/organization/api/organization.controller.ts:52` — `@Roles('PM')` on POST; `@Roles('PM','Admin')` on PATCH/DELETE.
- `Backend/src/module/organization/api/organization.service.ts:52` — defensive `actor.role !== 'PM'` check on create.
- `Backend/src/module/organization/api/policies/organization.policy.ts:13` — `canManage = Admin ∨ (PM ∧ owner)`.
- `Backend/src/common/guards/roles.guard.ts:49` — hard-coded `pm_required` 403 body.
- `Backend/src/module/auth/api/dto/register.dto.ts:51` — `@IsIn(ROLES)` (today anyone can register as Admin).
- Frontend: `Frontend/src/lib/api.ts:4` (`Role` type), `Frontend/src/lib/dashboard.ts:3,8-32` (role labels), `Frontend/src/pages/SignupPage.tsx:21-25` (role picker), `Frontend/src/pages/DashboardPage.tsx:78` (gating uses demo `viewAs`, not the real role).

## 4. Backend changes

### 4.1 Roles & registration

1. `auth/constants/auth.constants.ts`
   - `ROLES = ['PM', 'Dev', 'Admin', 'HR']` (order matters: `roleEnum` is built from it and PG enums are append-only — `HR` must be the new tail value).
   - Add `REGISTERABLE_ROLES = ['PM', 'Dev', 'HR'] as const` — the signup whitelist.
   - Add `ORG_MANAGER_ROLES = ['Admin'] as const` conceptually (used via `@Roles('Admin')`, no new constant strictly required).
2. `dto/register.dto.ts` — `@IsIn(REGISTERABLE_ROLES)` instead of `@IsIn(ROLES)`; Swagger `enum: REGISTERABLE_ROLES`; error message like `'Choose PM, HR or Dev — Admin accounts are provisioned internally.'`
3. `common/guards/roles.guard.ts` — replace the hard-coded `pm_required` body with a generic one:
   - `status: 'role_forbidden'`, `message: 'Your role is not allowed to perform this action.'`
   - Update the doc comment (it currently says every gated route is PM-gated).

### 4.2 Schema

1. `database/schema/users.ts`
   - `roleEnum('role')` picks up `HR` automatically from `ROLES` (no manual enum edit; migration must append the value).
   - Default stays `'PM'`.
2. No change to `organizations.ts` (singleton untouched).
3. Generate the migration: `npm run db:generate` in `Backend/` → expected SQL: `ALTER TYPE "role" ADD VALUE 'HR';` (verify drizzle emits this as a safe statement; enums are append-only).

### 4.3 Organization module

1. `organization.controller.ts`
   - POST `@Roles('Admin')` (was `'PM'`).
   - PATCH `@Roles('Admin')` (was `'PM','Admin'`).
   - DELETE `@Roles('Admin')` (was `'PM','Admin'`).
   - GET unchanged (`SessionAuthGuard` only).
   - Update `@ApiOperation` summaries and 403 Swagger examples (`admin_required` / `role_forbidden` wording instead of `pm_required`).
2. `organization.service.ts`
   - `create` defense check: `actor.role !== 'Admin'` → 403 `admin_required` (rename constants; see 4.4).
   - `update` / `remove`: `requireOrganization` + `requireManage` flow unchanged.
   - Comments updated (they describe PM-only creation and PM-owner ownership today).
3. `policies/organization.policy.ts`
   - `canManage(actor) = actor.role === 'Admin'` — drop the PM-owner branch. The `organization` parameter becomes unused; decide one of:
     - keep the signature `(actor, _organization)` for a stable policy API, or
     - simplify to `canManage(actor)`.
     - Recommendation: keep `(actor, organization)` and mark the param unused-if-not-needed only if a future policy needs it; otherwise simplify — YAGNI.
   - Note: `createdByUserId` remains stored (whoever Admin is when creating); it no longer grants rights.
4. `constants/organization.constants.ts`
   - Rename/replace `pm_required` → `admin_required` (`'Only an Admin can perform this action.'`).
   - Keep `organization_exists`, `organization_not_found`, `not_organization_owner` (reword message to "Only an Admin can manage the organization." if it stays), `empty_update`.
5. `repositories/organization.repository.ts` — no logic change; `findSingleton`, `insert` (23505 → 409), `update`, `remove` stay.

### 4.4 Swagger / docs touch-ups

- Controller `example(...)` blocks for 403 responses.
- `Backend/src/module/organization/docs/organization-plan.md` — add a short "superseded by admin-organization-plan.md" note at the top (do not rewrite history).

## 5. Frontend changes

### 5.1 Types & constants

1. `Frontend/src/lib/api.ts:4` — `export type Role = 'PM' | 'Dev' | 'Admin' | 'HR';`
2. `Frontend/src/lib/dashboard.ts`
   - `RoleKey = 'pm' | 'admin' | 'dev' | 'hr';`
   - `toRoleKey` — handles `'HR'` → `'hr'` (the existing `toLowerCase()` cast already works; verify exhaustiveness of `ROLES` record).
   - `ROLES` record: add `hr` entry (label `'HR'`, distinct badge `cls`/`dot` from the existing palette — e.g. reuse `bg-mist`/paper tones, description like `'Handles people operations and invites.'` — final copy decided at implementation).
   - `ROLE_ORDER` — insert `'hr'` (recommended: `['pm', 'hr', 'dev', 'admin']` or keep admin visible for display; picker uses its own list, see below).

### 5.2 Signup

1. `SignupPage.tsx` — `ROLE_OPTIONS` becomes PM / HR / Dev (Admin removed). Labels: `'Project Manager'`, `'Human Resources'`, `'Developer'`.
2. No other signup-flow change (register stays open, email verification untouched).

### 5.3 Dashboard gating (replace the demo `viewAs` gate)

1. `DashboardPage.tsx:78` — derive from the real session role:
   - `canManageOrg = authUser?.role === 'Admin'` → gates Edit organization, Delete organization, and the whole `EmptyOrgView` create form.
   - `canManageMembers` (invite/remove/role buttons — **visual state only for now**, member APIs are out of scope): decide at implementation; simplest consistent rule: `['Admin', 'HR', 'PM'].includes(role)` for member controls, `Admin`-only for org controls.
   - `viewAs` for display (role badge in the hero, role description line) → `toRoleKey(authUser.role)`; remove `viewAs` from demo state usage where it drives gating.
2. `OrgView.tsx` — split the single `canManage` prop into `canManageOrg` and `canManageMembers`:
   - Edit organization button, Danger zone (delete) → `canManageOrg`.
   - Add member button, per-row role select/remove → `canManageMembers` (stays non-functional for now; `onAddMember` may keep the local-only demo behavior or be hidden — recommendation: hide actions that have no backend rather than show fake ones, but that is a judgment call at implementation time).
3. `EmptyOrgView.tsx` — shown only to Admins with no org:
   - Footer copy: `'Only an Admin can create the organization. If you're expecting an invite, ask your Admin…'`
   - Step 01 copy: no more "You become its PM" → e.g. `'Give it a name and claim a URL.'`
   - Step 02 invite copy mentions roles PM, HR or Dev (cosmetic only).
4. **New non-Admin empty state** — when `org === null` and `role !== 'Admin'`: a simple "No organization yet" panel ("You'll see the organization here once an Admin creates it / adds you") instead of the create form. No new backend call.

### 5.4 Copy that references PM ownership

- `EmptyOrgView.tsx` (above), `OrgView.tsx` empty-projects line (`'Your PM will add them here.'` → neutral `'Your Admin or PM will add them here.'` or similar), `OrgView` role description line renders from the real role automatically once `viewAs` is replaced.

## 6. Test updates (Backend)

1. `organization.controller.spec.ts` — decorator/guard expectations: POST/PATCH/DELETE gated to `Admin`; 403 example bodies.
2. `organization.service.spec.ts` — create defense: non-Admin (PM/HR/Dev) → 403 `admin_required`; policy: Admin manages regardless of `createdByUserId`, PM-owner does **not**.
3. `register` specs (`auth.service.spec.ts` / DTO validation if present) — `role: 'Admin'` now fails validation; `HR` accepted.
4. `roles.guard` — if a spec exists, update the expected 403 body; otherwise add a small spec for `role_forbidden`.
5. New/updated enum consistency: a unit assertion that `REGISTERABLE_ROLES ⊂ ROLES` and `'HR' ∈ ROLES` (cheap guard against drift).

## 7. Execution order

1. Backend roles constants + register DTO + RolesGuard body.
2. Schema (`roleEnum` picks up HR) + `db:generate` + review migration.
3. Organization controller/service/policy/constants → Admin-only.
4. Backend tests updated/added → `npm run lint && npm run typecheck && npm test`.
5. Frontend types/labels (`api.ts`, `dashboard.ts`).
6. Signup picker (PM/HR/Dev).
7. Dashboard gating (`DashboardPage`, `OrgView`, `EmptyOrgView`, new non-Admin empty state).
8. Frontend `npm run lint && npm run typecheck`.
9. Grep pass for stale `pm_required` / "only a PM" copy across both apps.

## 8. Verification checklist

- [ ] `ROLES` = PM, Dev, Admin, HR; migration appends `'HR'` to the PG enum.
- [ ] Register with `role: 'Admin'` → 400; `PM`/`HR`/`Dev` → 201.
- [ ] PM (or HR/Dev) `POST /organization` → 403 `admin_required`; Admin → 201.
- [ ] PATCH/DELETE: Admin → allowed; PM-owner → 403 (owner no longer matters); Dev/HR → 403.
- [ ] GET `/organization` still works for any signed-in user.
- [ ] Signup page shows PM / HR / Dev only.
- [ ] Dashboard: Admin sees edit/delete + create form when empty; non-Admin sees read-only view / "no organization" panel; role badge shows HR correctly.
- [ ] Backend: lint, typecheck, jest green. Frontend: lint, typecheck green.

## 9. Follow-ups (explicitly later)

- Admin seed script (you will do this later).
- Invitations (email link + token) and member management endpoints — deferred entirely.
- Multi-organization, project/task backends.
