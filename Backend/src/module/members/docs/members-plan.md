# Members Module — Implementation Plan

Plan for the members feature: inviting users to the (singleton) organization by email, accepting invitations through a mailed link, and role-managed membership (list / change role / remove). Frontend wiring is included because the dashboard's member UI currently runs on demo state and must be re-pointed at this API.

## 1. Confirmed decisions

| Decision | Answer |
|---|---|
| Scope | **Admin, HR, PM** may add members — always **by email**, never by picking an account |
| Invite mail | A confirmation mail goes to the invitee; the org join happens **only** when they open the link and accept |
| Invitee has a verified account, no org | Accepted directly (after sign-in) via the invite link |
| Invitee has **no** account | Invite link routes to the **signup page** with the invited email locked in; after register + verify + sign-in the invite is accepted |
| Invitee has an **unverified** account | Reuse the existing **verify-email flow**, then accept (invite token carried through the loop) |
| Role storage | **Keep `users.role`** as the runtime role (session snapshot, `RolesGuard`, seed untouched). `organization_members.invitedRole` is **nullable and meaningful only while `status = 'INVITED'`** — a single source of truth per state (§2) |
| Admin mutability | **Admins can be role-changed and removed by other Admins** (peer Admin steps down / is removed). **No self-service** for anyone — a departing Admin is removed *by a peer*. Org must always retain ≥1 ACTIVE Admin (race-safe, §1.1) |
| Register never grants role | **`role` is removed from the register DTO** — registration grants the schema default (`PM`) only. Role enters an account through exactly two paths: **invite accept** (inviter-chosen, policy-checked) or **seed script** (Admin) |
| Stale-role defense | Three layers: **`ActiveMemberGuard`** on org-scoped routes, **`users.role` reset to `Dev`** on removal (same transaction), and **`GET /organization` returns `null` to non-members** (§5.3, §5.6) |
| Existing accounts | No backfill — the dev DB will be wiped; the org creator bootstraps membership at org-create time |
| Self-service | **None** — a user can never change their own role or remove themselves |

### 1.1 Permission matrix (single source of truth for the policy layer)

Actor must be an **ACTIVE member** with role `Admin | HR | PM` to manage anyone (`Dev` members are read-only).

| Actor | Invite role | Change role of | Remove |
|---|---|---|---|
| **Admin** | PM, Dev, HR, **Admin** | **Anyone — including other Admins** (may promote a non-Admin **to** Admin, may demote a peer Admin) | **Anyone — including other Admins** |
| **HR** | PM, Dev, **HR** (may invite a peer HR) | PM, Dev (**not** HR — HR cannot change another HR) | PM, Dev (**not** HR) |
| **PM** | PM, **Dev** (may invite a peer PM) | Dev only (**not** PM — PM cannot change another PM) | Dev only (**not** PM) |

Derived rules:

- **Target === actor → 403** (`self_manage_forbidden`) for every actor and every operation. There is no self-demotion and no "leave organization" — a departing Admin is removed by a peer Admin.
- **≥1 ACTIVE Admin invariant**: no role change or removal may leave the org with zero ACTIVE Admins. Enforced **inside the mutation transaction** (§4): every row-mutating membership operation first takes `pg_advisory_xact_lock(hashtext('nexus:members'))`, then re-counts ACTIVE Admins after the mutation; zero → `403 last_admin_required`, rollback. The lock serializes concurrent cross-mutations (two admins removing/demoting each other simultaneously would otherwise race to zero) and also collapses the accept-vs-remove race. Because self-service is forbidden, a non-racing zero-admin outcome is impossible — the check is race defense, plus a service-level assertion as defense in depth.
- `INVITED` rows are manageable too: role change updates `invitedRole` only (no auto-mail), removal deletes the row and kills the invite token.
- Listing members requires an ACTIVE membership but **any role** (`Dev` included) — the dashboard shows the team to everyone.
- `RolesGuard` alone is **never** a sufficient gate for an org-scoped route: every such route also carries `ActiveMemberGuard` (§5.6). Membership is read from Postgres per request — never from the session snapshot.

## 2. Database

New Drizzle table in `Backend/src/module/database/schema/organization-members.ts`, exported from `schema/index.ts`:

```ts
id                uuid PK default gen_random_uuid()
organizationId    uuid not null → organizations.id (FK, cascade)
userId            uuid not null → users.id (FK, cascade)
status            member_status enum('INVITED','ACTIVE') not null default 'INVITED'
invitedRole       role enum('PM','Dev','Admin','HR')  // NULLABLE — set only while INVITED
invitedByUserId   uuid → users.id (FK, set null)  // invite survives inviter removal
invitedAt         timestamptz not null defaultNow()
acceptedAt        timestamptz                        // null while INVITED
createdAt         timestamptz not null defaultNow()
```

Constraints (table config):

- `unique(organizationId, userId)` — double-invite/double-accept races collapse to `23505`, mapped by the repository (same pattern as the org singleton).
- **Status/role invariant, enforced by the database**:

  ```sql
  CHECK ((status = 'INVITED' AND invited_role IS NOT NULL)
      OR (status = 'ACTIVE' AND invited_role IS NULL))
  ```

  Drift between `users.role` and `invitedRole` is therefore not merely discouraged — after accept the mirror column no longer exists to drift from (§1 "single source per state"). Active members' roles live **only** in `users.role`.
- Index on `userId`, index on `status` (list filters + accept lookups).
- `member_status` is a **new append-only PG enum**, built from an exported constant (mirrors `roleEnum` from `auth.constants.ts`).

**Implemented deviation (plan bug found during implementation):** `userId` is **nullable**, not `NOT NULL` as first sketched above. The invite identity is the email — an invite can target an address that has no account yet, and the membership row must exist (and hold `invitedRole` + the Redis token) before that person signs up. `userId` is set at invite time when an account already exists, and set at accept time otherwise. The CHECK constraint was tightened accordingly:

```sql
CHECK ((status = 'INVITED' AND invited_role IS NOT NULL)
    OR (status = 'ACTIVE' AND invited_role IS NULL AND user_id IS NOT NULL))
```

`email varchar(255) NOT NULL` (unique per org) carries the identity in the INVITED state; the `unique(organizationId, userId)` index only bites once `userId` is populated. Accept copies email → user, invitedRole → `users.role`, fills `userId`, flips status in one transaction.

**State machine:**

| State | Role source | Mutations |
|---|---|---|
| `INVITED` | `invitedRole` (NOT NULL) | re-invite updates `invitedRole` + regenerates token · role change writes `invitedRole` only · removal deletes row + token · accept → copies to `users.role`, nulls `invitedRole`, flips status (one transaction) |
| `ACTIVE` | `users.role` (authoritative) | role change writes `users.role` only (single write — nothing to sync) · removal deletes row, revokes sessions, resets `users.role → Dev` (one transaction) |
| *(removed)* | `users.role = 'Dev'` | no membership row; re-invite starts fresh at `INVITED` |

Migration: `npm run db:generate` → new `drizzle/0006_*.sql`; `npm run db:migrate` against `POSTGRES_HOST_PORT` (never PgBouncer — DDL needs the direct port).

## 3. Invite tokens (Redis)

Mirrors the verification-token pattern exactly (`auth.service.ts` `issueVerificationToken` / `consumeToken`):

```
members:invite:<token>        → membershipId     (EX invite TTL)
members:invite:mid:<mid>      → token            (EX invite TTL, one active token per membership)
```

- Payload is an **id only** — no PII in Redis (same rule as mail queue jobs).
- TTL: env `INVITE_TOKEN_TTL_HOURS`, default **168** (7 days).
- Written **before** enqueueing the mail (enqueue-first would race the worker).
- **Re-invite** (same email, membership already `INVITED`): update `invitedRole`, regenerate the token (old link dies), resend.
- **Accept**: the DB transaction commits first, then the token keys are consumed best-effort (Redis after commit — the verification pattern's ordering rule). If the consume fails, the token still resolves but the membership is already `ACTIVE` → the second accept gets **409 `already_member`**, never a partial write.
- **Remove**: deletes the row; any leftover token 404s at lookup.
- Token values are `randomBytes(32).toString('hex')`.

## 4. Endpoints

Routes under the global prefix at `/api/v1/members`. Guard usage is **per route** (order matters — `RolesGuard` runs before `ActiveMemberGuard`):

| Route | Guards | Caller |
|---|---|---|
| `GET /members` | SessionAuthGuard → **ActiveMemberGuard** (no `RolesGuard` — Dev may view) | Any ACTIVE member |
| `POST /members/invites` | SessionAuthGuard → RolesGuard(`Admin`,`HR`,`PM`) → ActiveMemberGuard | Matrix `canInviteRole` |
| `POST /members/invites/:id/resend` | Same as invite | Same actor rules as invite |
| `PATCH /members/:id/role` | SessionAuthGuard → RolesGuard(`Admin`,`HR`,`PM`) → ActiveMemberGuard | Matrix `canManageRole` |
| `DELETE /members/:id` | SessionAuthGuard → RolesGuard(`Admin`,`HR`,`PM`) → ActiveMemberGuard | Matrix `canRemove` |
| `GET /members/invites/:token` | **Public** (no session) | Token holder |
| `POST /members/invites/:token/accept` | Public + `@Throttle`; session read for identity | Token holder signed in as the invited email |

The **service re-checks policy + ACTIVE membership** behind every guard (defense in depth, matching `organization.service.ts`).

| Route | Behavior |
|---|---|
| `GET /members` | `{ members: [{ id, name \| null, email, role, status, invitedAt, acceptedAt, invitedBy }] }`. `name` is `null` for an `INVITED` row whose account doesn't exist yet (frontend falls back to the email local-part). `role` comes from `invitedRole` while INVITED, from `users.role` while ACTIVE (single JOIN per the org plan's recorded rule) |
| `POST /members/invites` | Body `{ email, role }` (`@NormalizeEmail()`, `@IsIn(ROLES)`). `@Throttle` (10/10min — mail-bomb guard). Org must exist → else **409 `organization_required`**. Self-invite → **403 `self_invite_forbidden`**. ACTIVE membership exists → **409 `already_member`**. Existing INVITED → update `invitedRole` + regenerate + resend (**200**). Else insert `INVITED` row → token → enqueue mail → **201**. Invite creation relies on the unique constraint + `23505` retry (no advisory lock needed — it mutates no existing row) |
| `PATCH /members/:id/role` | Body `{ role }`. Membership missing → **404 `member_not_found`**. Target === actor → **403 `self_manage_forbidden`**. Policy fail (HR→HR, PM→PM, non-Admin targeting Admin is now **allowed** only per matrix — i.e. Admin actors pass, HR/PM fail on Admin targets) → **403**. **Transaction**: `pg_advisory_xact_lock` → write **exactly one column**: ACTIVE → `users.role` (never `invitedRole`); INVITED → `invitedRole` (never `users.role`) → post-write ACTIVE-Admin count ≥1 else **403 `last_admin_required`** → commit → if ACTIVE, `updateRoleForUser` on the target's live sessions. Same-role no-op → **200** without writes |
| `DELETE /members/:id` | Same pre-checks as role change (self → **403**, matrix → **403**, missing → **404**). **Transaction**: advisory lock → delete membership row → if it was ACTIVE: `users.role = 'Dev'` (constant `REMOVED_MEMBER_ROLE`) + Active-Admin count ≥1 else **403 `last_admin_required`** → commit. Post-commit: `SessionService.revokeAllForUser` (ACTIVE only) so access ends immediately; INVITED also deletes the Redis token keys (link dies). **200** |
| `POST /members/invites/:id/resend` | Regenerate token + enqueue mail for an `INVITED` row (handles Redis flush / lost mail / expired link). **409** if the member is already ACTIVE |
| `GET /members/invites/:token` | **200** `{ status: 'valid', email, orgName, role, accountState: 'none' \| 'unverified' \| 'verified' }` or **404 `invite_invalid_or_expired`**. The token *is* the capability, so revealing the invited email to its holder is safe |
| `POST /members/invites/:token/accept` | **404** invalid/consumed token · **401** no session · **403 `invite_email_mismatch`** session email ≠ invite email · **403 `email_unverified`** account unverified · **409 `already_member`** membership already ACTIVE (idempotent-friendly) · org deleted mid-flight → row cascades away → 404. **Success — one transaction**: advisory lock → re-verify row still `INVITED` → `users.role := invitedRole`, `invitedRole := null`, `status := ACTIVE`, `acceptedAt := now()` (the copy and the null are atomic — the CHECK constraint passes by construction) → commit → consume Redis token (best-effort, §3) → `updateRoleForUser` (caller's session still carries the register-default `PM`; may be promoted all the way to `Admin` here) → **200** |

Error bodies are always `{ status: snake_case, message: string }`, constants in `constants/members.constants.ts` (including `last_admin_required`, `self_manage_forbidden`, `not_active_member`, `removed_member_role`), shared role statuses reusing `common/constants/role.constants.ts`.

## 5. Supporting backend changes

### 5.1 Mail (`module/mail/`)

- `templates/invite-member.ts` — `{ subject, text, html }`; link `${FRONTEND_URL}/accept-invite?token=...` (mirrors `verify-email.ts` / `buildVerifyEmailLink`).
- `constants/mail.constants.ts` — `JOB_SEND_INVITE_MEMBER`.
- `processors/send-invite.processor.ts` — payload `{ membershipId }` only; re-fetches membership + user + org at execution time (no PII/tokens in the job), registers in `mail.module.ts` alongside the existing processors.
- `mail.queue.ts` — `enqueueInviteMember(membershipId)` with `deduplication: { id: 'invite:<mid>', keepLastIfActive: true }`, attempts 5, exponential backoff (same job options as `enqueueVerification`).
- Enqueue failures are logged via the `safeEnqueue` pattern, never surfaced — the invite row stays and **Resend** is available.

### 5.2 Sessions (`module/auth/api/session/`)

New method on `SessionService`:

```ts
updateRoleForUser(userId: string, role: Role): Promise<void>
```

- Read `user:sessions:<uid>` zset → `GET` each `session:<sid>` → patch `role` in the JSON → `SET` with the **original remaining TTL** (preserves remember-me).
- Used by (a) accept — caller's session role is stale (`PM` default → invited role, possibly `Admin`), (b) role change — target's live sessions must never serve a stale role to `RolesGuard`.
- Failures logged like other session writes; a session that vanished between GET/SET is skipped.

### 5.3 Organization (`module/organization/api/`) — membership awareness

- `POST /organization`: in the **same transaction** as the org insert, create the creator's **ACTIVE Admin membership** (role copied from `users.role`, which is `Admin` via seed) — otherwise no Admin could ever manage members (every management path requires ACTIVE membership). `ActiveMemberGuard` is lenient when **no org row exists** (creation path — the seed Admin has no membership yet by definition).
- **`GET /organization` membership gating**: returns `{ organization: null }` to any signed-in user **without an ACTIVE membership** (response shape unchanged — no frontend contract change). This is the primary UX fix for removals: a removed member's dashboard drops into the existing "Ask your Admin to add your email" state. Route stays `SessionAuthGuard` only (**no** `ActiveMemberGuard` — that guard would 403 where the service must answer `null`).
- `PATCH` / `DELETE /organization`: add `ActiveMemberGuard` to the existing `@UseGuards(SessionAuthGuard, RolesGuard)` + `@Roles('Admin')`, **and** keep the service-level ACTIVE-membership re-check (defense in depth). Without this, a stale-`Admin`-role sign-in could still edit the org; with the role reset (§5.6) they would additionally fail `RolesGuard`.
- `OrganizationModule` imports `MembersModule` (one-way; `MembersModule` never imports it — the singleton org row is read through the shared schema/DRIZZLE, avoiding a cycle).

### 5.4 Register never grants role (`module/auth/api/`)

Verified current state: `register.dto.ts:63` accepts `role` (capped at `REGISTERABLE_ROLES = PM|Dev|HR`) and `user.factory.ts:20` trusts it — self-asserted. Changes:

- **`dto/register.dto.ts`**: delete the `role` field, its `@IsIn`/`@ApiProperty`, and the `REGISTERABLE_ROLES` import. The global whitelist pipe now **silently strips** any client-sent `role`.
- **`constants/auth.constants.ts`**: delete `REGISTERABLE_ROLES` + `RegisterableRole`; add `DEFAULT_ROLE = 'PM'` (documented to match the schema default; Admin still only via seed).
- **`factories/user.factory.ts`**: `role: DEFAULT_ROLE` instead of `dto.role`.
- **`dto/register.dto.spec.ts`**: drop the "accepts registerable role" cases; **add**: a payload containing `role` fails the whitelist (unknown field) / the factory always yields `DEFAULT_ROLE`.
- **`organization.service.spec.ts`**: remove the `REGISTERABLE_ROLES ⊂ ROLES` subset test (constant no longer exists).
- **Plan statement (feature invariant):** *role enters an account only via (a) invite accept — inviter-chosen and policy-checked against §1.1 — or (b) the seed script for Admin. Registration grants the default and nothing else; no client-asserted role is trusted anywhere.*

### 5.5 Bootstrap fix

`Backend/src/app.module.ts:8` — broken import `./members/members.module` → `./module/members/api/members.module` (currently fails typecheck; the scaffold was placed under `module/`).

Seed script: **no change** (org doesn't exist at seed time; membership starts at org-create).

### 5.6 `ActiveMemberGuard` (`module/members/api/guards/`)

New Nest guard, **exported from `MembersModule`** (it needs the `DRIZZLE` token; keeping it out of `common/` preserves the layering — `RolesGuard` in `common/` has no DI):

```ts
// Pseudo-semantics
if (organization exists && caller has no ACTIVE membership) → 403 not_active_member
else → pass   // covers "no org yet" (creation paths) — services handle org-missing with their own 409/404
```

- Query: singleton org + `ACTIVE` membership for `req.user.userId`, one indexed statement per request (low-volume admin routes; no session caching — **fresh DB read every request**, so a removal takes effect on the very next call even before session revocation lands).
- Applied per §4/§5.3 route tables; documented as a hard convention: **`RolesGuard` alone is never sufficient for org-scoped routes** — future modules must add it.
- Fails closed on repository errors (500, mirroring `SessionAuthGuard`'s Redis-outage stance — never silently pass).

## 6. Files — new / rewritten

```
Backend/src/
├── app.module.ts                                        [FIX] MembersModule import path
├── module/
│   ├── database/schema/organization-members.ts          [NEW] table + member_status enum + status/role CHECK
│   ├── database/schema/index.ts                         [EDIT] export organizationMembers
│   ├── mail/
│   │   ├── constants/mail.constants.ts                 [EDIT] JOB_SEND_INVITE_MEMBER
│   │   ├── mail.module.ts                               [EDIT] register invite processor
│   │   ├── mail.queue.ts                                [EDIT] enqueueInviteMember()
│   │   ├── processors/send-invite.processor.ts          [NEW]
│   │   └── templates/invite-member.ts                   [NEW]
│   ├── auth/api/
│   │   ├── dto/register.dto.ts                          [EDIT] remove role field + REGISTERABLE_ROLES (§5.4)
│   │   ├── dto/register.dto.spec.ts                     [EDIT] role-stripped + default-role specs
│   │   ├── constants/auth.constants.ts                 [EDIT] remove REGISTERABLE_ROLES; add DEFAULT_ROLE
│   │   ├── factories/user.factory.ts                   [EDIT] role: DEFAULT_ROLE
│   │   └── session/session.service.ts                   [EDIT] updateRoleForUser()
│   ├── organization/api/
│   │   ├── organization.module.ts                       [EDIT] import MembersModule
│   │   ├── organization.controller.ts                   [EDIT] ActiveMemberGuard on POST/PATCH/DELETE (§5.3)
│   │   ├── organization.service.ts                      [EDIT] create → bootstrap Admin membership; GET → null for non-members; manage paths re-check ACTIVE
│   │   ├── organization.service.spec.ts                [EDIT] remove REGISTERABLE_ROLES subset test; add GET-gating + bootstrap specs
│   │   └── repositories/organization.repository.ts      [EDIT] transactional org+membership insert
│   └── members/
│       ├── docs/members-plan.md                         [NEW] this document
│       └── api/
│           ├── constants/members.constants.ts           [NEW] every status/message pair (incl. last_admin_required, self_manage_forbidden, not_active_member, REMOVED_MEMBER_ROLE='Dev')
│           ├── guards/active-member.guard.ts            [NEW] §5.6 + colocated spec
│           ├── dto/invite-member.dto.ts                 [NEW] email + role
│           ├── dto/change-member-role.dto.ts            [NEW] role
│           ├── dto/members-responses.dto.ts             [NEW] MemberResponseDto, InvitePreviewResponseDto, InviteAcceptedResponseDto
│           ├── entities/member.entity.ts                [NEW] props + getters (User ∥ Membership view)
│           ├── factories/member.factory.ts              [NEW] build INVITED membership rows
│           ├── policies/members.policy.ts               [NEW] canInviteRole / canManageRole / canRemove (matrix §1.1, Admin↔Admin allowed, self never)
│           ├── repositories/members.repository.ts       [NEW] @Inject(DRIZZLE); list JOIN, upsert-invite, tx helpers (advisory lock + mutation + admin-count), 23505→409
│           ├── members.controller.ts                    [REWRITE] §4 routes, per-route guards, @Throttle, Swagger
│           ├── members.service.ts                       [REWRITE] orchestration, policy + membership re-checks, last-admin invariant, role-reset-on-remove
│           ├── members.module.ts                        [REWRITE] import AuthModule (SessionAuthGuard, SessionService), MailModule (MailQueue); export MembersService/MembersRepository/ActiveMemberGuard for OrganizationModule
│           └── members.{service,controller}.spec.ts     [REWRITE] §9 test groups
└── (invite token helpers live in members constants)
```

The Nest CLI scaffold (`create-member.dto.ts`, `update-member.dto.ts`, numeric-id stubs, placeholder service strings) is replaced/removed.

Frontend (this pass, required for the feature to be usable):

```
Frontend/src/
├── lib/api.ts                          [EDIT] RegisterPayload drops role; add listMembers, inviteMember, changeMemberRole, removeMember, resendInvite, getInvitePreview, acceptInvite + types
├── store/slices/membersSlice.ts        [NEW] list cache + loading (mirrors orgSlice)
├── store/index.ts                      [EDIT] register slice
├── pages/AcceptInvitePage.tsx          [NEW] orchestrator (§7)
├── pages/SignupPage.tsx                [EDIT] remove role picker entirely (ROLE_OPTIONS, role state, validation, payload field); invite mode adds ?invite= locked email + banner
├── pages/LoginPage.tsx                 [EDIT] post-login return to pending invite when set
├── pages/VerifyEmailPage.tsx           [EDIT] carry pending invite through the verify → login → accept loop
├── pages/ConfirmSentPage.tsx           [EDIT] same pending-invite carry (if it owns the "check inbox" copy)
├── pages/DashboardPage.tsx             [EDIT] real members instead of createDemoState(); handlers call API + refresh (gating flags unchanged — org-null for non-members hides the member UI entirely)
├── components/dashboard/OrgView.tsx    [EDIT] filtered role options, disabled rows per matrix (incl. Admin rows now editable by peer Admins), Resend action, status from real field
└── router.tsx                          [EDIT] /accept-invite route (public)
```

## 7. Frontend flow — `/accept-invite?token=...`

`AcceptInvitePage` fetches the public preview, then branches on `accountState` × auth status:

| Account state | Signed out | Signed in |
|---|---|---|
| **none** | CTA → `/signup?invite=<token>` (email locked, **no role picker anywhere on signup** — role comes from the invite) | — (can't be signed in without an account) |
| **unverified** | CTA → verify-email flow; token kept in `sessionStorage('pending_invite')` → after verify → login → back to accept | — (login is blocked pre-verification anyway) |
| **verified** | CTA → login; on success return to accept | **Accept invite** button → `POST accept` → toast → `/dashboard` |

Failure states: invalid/expired token → dead-link page ("Ask your Admin to resend"); signed-in email ≠ invited email → "Sign out to accept this invitation"; accept 409 `already_member` → success-style message + dashboard.

Pending-invite round-trip: `sessionStorage` key set when the link is opened, cleared on successful accept or when the user starts a non-invite signup/login.

**Implemented addition — auto-join at email verification:** an invitee who signs up with the invited address no longer has to click through the accept page. `POST /auth/verify-email`, after consuming the verification token, best-effort runs `MembersRepository.acceptPendingForEmail(email, userId)` — the same accept transaction (advisory lock, `invitedRole → users.role`, `userId` filled, `ACTIVE`) selected by the invite identity — and deletes the invite's Redis token keys. Proving address ownership **is** the accept (same bar the accept endpoint itself enforces). A failure there is logged loudly and never fails verification; the accept page remains the manual fallback, and it now also auto-accepts on its `ready` state (signed-in + verified + email match) with the button as error fallback. AuthModule provides `MembersRepository` directly (DRIZZLE-only) so no Auth ↔ Members module cycle forms.

Dashboard honesty after removal: `GET /organization → null` → removed user sees the existing *"Ask your Admin to add {email}"* state (not the member table with buttons that 403). Their `auth/me` role also reads `Dev` (§5.6), so no stale `Admin`-gated UI (e.g. create-organization) renders either.

## 8. Edge cases (acceptance checklist)

1. **No organization yet** → invite POST **409 `organization_required`**; dashboard hides the invite dialog until an org exists. `ActiveMemberGuard` is lenient when no org exists so `POST /organization` still works for the org-less seed Admin.
2. **Re-invite same email** → updates `invitedRole`, regenerates token (old link dies), resends — no duplicate rows (unique constraint + `23505` retry path).
3. **Invite to an ACTIVE member** → **409 `already_member`** (change role instead).
4. **Self-invite** → **403**; **self role-change / self-remove** → **403 `self_manage_forbidden`** (all roles — a departing Admin is removed by a peer).
5. **Invite with role the actor can't grant** (HR→Admin, PM→HR, …) → **403** from the policy before anything is written.
6. **Admin manages an Admin** (role change or removal, peer-to-peer) → **allowed**; demotion-to-Admin (promotion) also allowed.
7. **HR→HR and PM→PM** → role change / remove **403**; **inviting** a peer HR / peer PM → allowed.
8. **Zero-admin race** — two admins concurrently removing or demoting each other → advisory lock serializes them; the second transaction's post-mutation ACTIVE-Admin count hits 0 → **403 `last_admin_required`**, rollback. Non-racing zero-admin is impossible (no self-service) — service still asserts the count as defense in depth.
9. **No account at invite time** → `INVITED` row with `name = null`; signup locks the email and has **no role field at all**; role applied at accept, not register.
10. **Register payload smuggles `role`** → global whitelist strips it; persisted role is `DEFAULT_ROLE` (`PM`). No client-asserted role is trusted anywhere (§5.4 invariant).
11. **Unverified account** → preview `accountState: 'unverified'`; accept re-checks `isVerified` → **403** if reached early; flow routes through verify.
12. **Wrong signed-in user accepts** → **403 `invite_email_mismatch`**.
13. **Token expired / consumed / Redis flushed** → 404 at preview/accept; **Resend** regenerates.
14. **Member removed after the mail was sent** → row deleted → token lookup 404.
15. **Double-accept (two tabs)** → unique constraint + advisory lock; second request resolves to success or **409 `already_member`**, never a partial write.
16. **Accept vs remove race** → both take the advisory lock; accept re-verifies the row is still `INVITED` inside the transaction — a remove that committed first turns accept into a 404, a remove that runs after commits first turns it into 409. Exactly one wins.
17. **`invitedRole` / `users.role` drift** → structurally impossible: role change writes exactly one state's column; accept copies + nulls in one atomic transaction; the DB CHECK rejects any orphaned state. Tests assert each transition (§9).
18. **Removed member's access** → all sessions revoked immediately (`revokeAllForUser`) **and** `users.role` reset to `Dev` in the removal transaction **and** `GET /organization` returns `null` → next sign-in: honest `auth/me` (`Dev`), correct dashboard state, and every org-scoped route blocked by `ActiveMemberGuard` even if a future route forgets `RolesGuard`. Their previous role is gone — re-invite starts fresh at `INVITED`.
19. **Removed Admin must not see create-organization UI** → role reset to `Dev` means `canManageOrg = false`; without the reset they'd get `org → null` as an `Admin` and hit a confusing 409 on create.
20. **Stale session role** after accept or role change → `updateRoleForUser` patches every live session (remember-me TTL preserved).
21. **Actor's membership dies between guard and service** → guard reads DB per request + service re-checks ACTIVE membership → 403.
22. **Inviter removed while an invite is pending** → `invitedByUserId` set `null`, invite stays valid.
23. **Organization deleted** → memberships cascade (`FK cascade`); pending tokens 404.
24. **Mail enqueue failure** → logged, invite row remains, Resend available; never a 5xx.
25. **Invite endpoint abuse** → `@Throttle` (10/10min) on invite + resend + accept.
26. **Role change of an INVITED row** → `invitedRole` updated, token untouched (accept applies the newest role); UI offers Resend if the emailed copy should be refreshed.
27. **Same-role PATCH no-op** → 200 without writes (advisory lock not taken).
28. **Email casing/whitespace** → `@NormalizeEmail()` + repository lookup on the normalized value.
29. **Validation** → role must be in the append-only `ROLES`; unknown JSON fields stripped by the global whitelist pipe.
30. **`ActiveMemberGuard` DB outage** → fails closed (500), never silently passes — mirrors `SessionAuthGuard`'s Redis-outage stance.

## 9. Delivery order

1. Schema (`organization-members.ts` + status/role CHECK + index export) → `db:generate` / `db:migrate`.
2. `SessionService.updateRoleForUser()`.
3. Mail: template → job constant → processor → `enqueueInviteMember()`.
4. Members module: constants → policy (Admin↔Admin matrix) → factory/entities → repository (tx helpers: advisory lock + admin count) → service → controller → **`ActiveMemberGuard`** → module rewrite (scaffold replacement) + `app.module.ts` import fix.
5. Organization: transactional membership bootstrap + `GET` membership gating + `ActiveMemberGuard` on mutate routes + service re-checks.
6. Register role removal: DTO → constants (`DEFAULT_ROLE`, drop `REGISTERABLE_ROLES`) → factory → specs (§5.4).
7. Backend specs green — groups: **(a)** §1.1 matrix incl. Admin↔Admin + self-forbidden, **(b)** last-admin race/invariant, **(c)** state invariants (accept copies+nulls atomically; role change writes only its state's column; CHECK constraint), **(d)** register strips client `role` / persists `DEFAULT_ROLE`, **(e)** guard semantics (lenient-no-org, fails-closed). Full typecheck.
8. Frontend: `api.ts` (incl. `RegisterPayload` without role) → `membersSlice` → `AcceptInvitePage` + route → `SignupPage` (picker removed + invite mode) / login / verify carry → `DashboardPage` + `OrgView` wiring.
9. Root `npm run lint` + `npm run typecheck` (Biome), both apps build.
10. Conventional commit(s): `feat(members): ...`.
