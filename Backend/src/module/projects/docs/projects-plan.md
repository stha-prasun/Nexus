# Projects Module — Implementation Plan

Plan for the projects feature: creating projects within the (singleton) organization, managing project members **exclusively from the existing org roster**, team leads with a ≥1-lead invariant, and role-scoped visibility/management. Full-stack: backend module + dashboard wiring (the dashboard currently runs projects on demo state).

## 1. Confirmed decisions

| Decision | Answer |
|---|---|
| Membership rule | **Only existing org members can be project members.** No invite-by-email path exists here — adding someone not in the org (or not yet ACCEPTED) → 403 with "invite them to the organization first". The UI picker only ever offers the org roster |
| Create project | **Admin + PM only** (HR and Dev → 403) |
| Visibility | **Admin + HR → all projects** (HR is read-only oversight). **PM + Dev → only projects they are a member of** |
| PM "created" credit | Creator is auto-added as a member at creation. If removed from members, they **lose visibility and management** — `created_by` survives as display credit only ("Created by …") |
| Mutations | **Admin**: any project, any target (except invariants). **PM**: any project they can see (= are a member of) — add members of any role **except HR**, remove **Dev only** (Admin + peer PM protected), rename/recolor, delete. **HR**: zero mutations, and **not addable** as a project member. **Dev**: read-only member |
| Leads | **Multiple leads allowed** (`project_members.is_lead boolean`). Creation requires ≥1 explicit lead. **Last-lead removal/demotion → 403 `last_lead_required`** — nobody, not even Admin, may leave a project leadless. Same invariant applies when a lead is removed from the **organization** |
| Self-service | Self-removal from a project → 403 `self_remove_forbidden` (mirrors members: no self-service, not even Admin) |
| Creator at creation | Auto-added as member, **not** auto-lead. `leadUserIds` is a required, non-empty subset of members ∪ {creator} |
| Color | `projects.color` hex `#rrggbb`, validated, server default `#1F2FE0` |
| UI surface | Full-stack pass. Member management lives on a dedicated **`/dashboard/projects/:id`** detail page; "Open board" navigates there. Boards/tasks themselves are **out of scope** |
| Scale assumption | Singleton org, small roster → **no pagination** on project list |

### 1.1 Permission matrix (single source of truth for `ProjectsPolicy`)

Actor must be an **ACTIVE org member** on every route (`ActiveMemberGuard`).

**Visibility (GET):**

| Actor | Sees |
|---|---|
| **Admin** | All projects |
| **HR** | All projects (read-only) |
| **PM** | Projects they are a member of |
| **Dev** | Projects they are a member of |

**Mutations:**

| Actor | Create | Update / Delete project | Add member | Remove member | Lead on/off |
|---|---|---|---|---|---|
| **Admin** | ✓ | Any project | Any project — target role Admin/PM/Dev (HR forbidden) | Any member, not self, not sole lead | Any member; demote-last forbidden |
| **PM** | ✓ | Projects they're a member of | Same projects; target role Admin/PM/Dev | **Dev targets only**; not self, not sole lead | Same projects; demote-last forbidden |
| **HR** | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Dev** | ✗ | ✗ | ✗ | ✗ | ✗ |

Derived rules:

- **target === actor → 403** `self_remove_forbidden` for every role.
- **≥1 lead invariant**: any removal or lead-demotion that would take a project's lead count to 0 → **403 `last_lead_required`**, rollback. Enforced inside the mutation transaction under `pg_advisory_xact_lock(hashtext('nexus:project:' || projectId))` — same shape as the members module's `last_admin_required` (§2, §4).
- **Invisible project → 404 `project_not_found`** (missing and forbidden are indistinguishable — no existence leak).
- **`RolesGuard` alone is never sufficient** — every route also carries `ActiveMemberGuard`; the service re-checks visibility + target rules (defense in depth).

## 2. Database

Two new Drizzle tables, one file each (mirrors `organization-members.ts` / `organizations.ts`), exported from `schema/index.ts`:

**`module/database/schema/projects.ts`**

```ts
id                uuid PK default gen_random_uuid()
organizationId    uuid not null → organizations.id (FK, cascade)
name              varchar(100) not null
color             varchar(7) not null default '#1F2FE0'   // CHECK ~ '^#[0-9A-Fa-f]{6}$'
createdByUserId   uuid not null → users.id (FK, restrict)  // mirrors organizations.createdByUserId
createdAt         timestamptz not null defaultNow()
updatedAt         timestamptz not null defaultNow()        // Drizzle $onUpdate
```

Indexes: `organizationId`, `createdByUserId`. No name uniqueness — duplicate project names are allowed (intentional).

**`module/database/schema/project-members.ts`**

```ts
id                    uuid PK default gen_random_uuid()
projectId             uuid not null → projects.id (FK, cascade)
organizationMemberId  uuid not null → organization_members.id (FK, cascade)  // drives org-removal cleanup
userId                uuid not null → users.id (FK, cascade)                 // user-centric lookups
isLead                boolean not null default false
addedByUserId         uuid → users.id (FK, set null)                          // survives adder's removal
createdAt             timestamptz not null defaultNow()
```

Constraints: `unique(projectId, userId)`, `unique(projectId, organizationMemberId)`; indexes on `userId` (visibility + sole-lead checks) and `projectId`.

Why both FKs: `organizationMemberId` makes **"only org members" structural** — a project-membership row cannot outlive its org-membership row (org removal cascades it away); `userId` keeps the hot queries (my projects, sole-lead scan) single-join. Rows are only ever inserted together, so the pair can't drift.

**Invariant placement:** ≥1 lead is a *row-count* invariant — no table-level CHECK can express it. It lives in the service/repository under the per-project advisory lock (§1.1, §4). A DB trigger was considered and rejected (harder to test, hides logic from the policy layer).

Migration: `npm run db:generate` → `drizzle/0007_*.sql`; `npm run db:migrate` against `POSTGRES_HOST_PORT` (direct port — DDL-unsafe through PgBouncer).

## 3. Endpoints

Routes under the global prefix at `/api/v1/projects`. Guard order: `SessionAuthGuard → RolesGuard → ActiveMemberGuard` (roles first, per members convention); GET routes skip `RolesGuard` (every role may read, service filters).

| Route | Guards | Caller |
|---|---|---|
| `POST /projects` | Session → Roles(`Admin`,`PM`) → ActiveMember | Admin, PM |
| `GET /projects` | Session → ActiveMember | Any ACTIVE member (service: Admin/HR all; PM/Dev member-only) |
| `GET /projects/:id` | Session → ActiveMember | Visible else 404 |
| `PATCH /projects/:id` | Session → Roles(`Admin`,`PM`) → ActiveMember | Admin any; PM if member |
| `DELETE /projects/:id` | Session → Roles(`Admin`,`PM`) → ActiveMember | Admin any; PM if member |
| `POST /projects/:id/members` | Session → Roles(`Admin`,`PM`) → ActiveMember | Admin any; PM if member |
| `DELETE /projects/:id/members/:userId` | Session → Roles(`Admin`,`PM`) → ActiveMember | Admin any member; PM **Dev targets only** |
| `PATCH /projects/:id/members/:userId/lead` | Session → Roles(`Admin`,`PM`) → ActiveMember | Admin any; PM if member |

Service behaviors (all errors `{ status, message }`, constants in `projects.constants.ts`):

| Route | Behavior |
|---|---|
| `POST /projects` | Body `{ name, color?, memberUserIds?, leadUserIds }` — `name` `@Trim @MinLength(2) @MaxLength(100)`; `color` optional `@Matches(/^#[0-9A-Fa-f]{6}$/)` → default `#1F2FE0`; `memberUserIds` optional uuid[] (deduped, extra members beyond creator); **`leadUserIds` required, non-empty uuid[]**. Checks: org exists else **409 `organization_required`**; every referenced user has an **ACTIVE** org membership else **403 `not_org_member`** ("…invite them to the organization first"); target org role `HR` → **403 `project_member_role_forbidden`**; lead ∉ (members ∪ {creator}) → **400 `lead_not_member`**. **One transaction** inserts the project + membership rows (creator first; leads flagged). → **201 `{ project }`** |
| `GET /projects` | `{ projects: [...] }` — each item includes `members` (avatars/count render from it). Filter: Admin/HR → all; PM/Dev → `userId ∈ actor` |
| `GET /projects/:id` | Missing or invisible → **404 `project_not_found`**. **200 `{ project }`** full detail: members with `isLead`, `createdBy`, timestamps |
| `PATCH /projects/:id` | Body `{ name?, color? }` hand-written optional DTO (mirror `update-organization.dto.ts`); nothing to change → **400 `empty_update`**. Invisible → 404; HR/Dev → 403 (guard); PM must be member (service). **200 `{ project }`** |
| `DELETE /projects/:id` | Visibility/role pre-checks as PATCH; deletes project (members cascade). **200 `{ message }`** |
| `POST /projects/:id/members` | Body `{ userId }`. Invisible → 404; target not an ACTIVE org member → **403 `not_org_member`**; target org role HR → **403 `project_member_role_forbidden`**; already a project member → **409 `already_project_member`**. Insert; `23505` → 409 retry. → **201 `{ project }`** (refreshed) |
| `DELETE /projects/:id/members/:userId` | Invisible → 404; **self → 403 `self_remove_forbidden`**; membership row missing → **404 `project_member_not_found`**; **PM && target org role ≠ `Dev` → 403 `project_remove_forbidden`**. **Transaction**: per-project advisory lock → `FOR UPDATE` re-read → delete row → if target was a lead: recount leads → 0 → **403 `last_lead_required`**, rollback. → **200 `{ project }`** |
| `PATCH /projects/:id/members/:userId/lead` | Body `{ isLead: boolean }`. Invisible → 404; row missing → 404. Same-value → **200 no-op** (no lock, mirror same-role PATCH). **Demotion**: transaction with per-project lock → recount *other* leads → 0 → **403 `last_lead_required`**. Promotion: plain update. → **200 `{ project }`** |

Also: params validated as uuid (`@IsUUID()`); global whitelist pipe strips unknown fields. Optional `@Throttle` on `POST /projects` (no mail involved — default global limit is acceptable).

## 4. Supporting backend changes

### 4.1 Members module — sole-lead guard on org-member removal

`members.repository.removeMember()` (members.repository.ts:349-390) gains a pre-delete check inside its **existing** advisory-locked transaction:

1. After `lock(tx)` + `FOR UPDATE` row read, if the row is ACTIVE: select the target's projects where `isLead = true`.
2. **Acquire each such project's lock** — `pg_advisory_xact_lock(hashtext('nexus:project:' || projectId))`, **sorted ascending by projectId** (deadlock-free ordering).
3. Re-count leads per project; any project at 1 → throw `SoleLeadError` → **403 `project_last_lead_required`** ("Promote another team lead before removing this member."), rollback. Otherwise the delete proceeds and the FK cascade cleans up all their project rows.

Lock-ordering argument (documented in code): member removal takes *members-lock → project-locks(sorted)*; project mutations take *project-lock only, never the members lock* — so the graph is acyclic and no deadlock is possible. Both lead-count reads happen under both relevant locks → the interleaving race (two leads removed concurrently, one via org-removal, one via project-removal) is closed.

The query reads the **shared schema through DRIZZLE directly** — precedent: members-plan §5.3 reads the org row the same way to avoid a module cycle. `ProjectsModule` imports `MembersModule` (for `ActiveMemberGuard`), so `MembersModule` must **not** import `ProjectsModule`.

Also: `constants/members.constants.ts` adds the `project_last_lead_required` status/message pair; `members.service.ts` maps `SoleLeadError` → 403; specs extend the removal group.

### 4.2 Bootstrap fix (blocks typecheck today)

`Backend/src/app.module.ts:9` — `./projects/projects.module` → `./module/projects/api/projects.module`.

### 4.3 Out of scope (explicit)

Task boards/lists · mail/notification when added to a project · project-level invites of non-members · pagination · editing `created_by` · HR/Dev creating projects.

## 5. Files — new / rewritten

**Backend**

```
Backend/src/
├── app.module.ts                                        [FIX] ProjectsModule import path (§4.2)
├── module/
│   ├── database/schema/projects.ts                      [NEW] projects table + color CHECK
│   ├── database/schema/project-members.ts               [NEW] project_members + is_lead + dual FK
│   ├── database/schema/index.ts                         [EDIT] export both
│   ├── members/api/
│   │   ├── constants/members.constants.ts               [EDIT] project_last_lead_required
│   │   ├── repositories/members.repository.ts           [EDIT] sole-lead lock+check in removeMember tx, SoleLeadError
│   │   ├── members.service.ts                           [EDIT] SoleLeadError → 403
│   │   └── members.service.spec.ts                      [EDIT] org-removal lead-invariant specs
│   └── projects/
│       ├── docs/projects-plan.md                        [NEW] this document
│       └── api/
│           ├── constants/projects.constants.ts          [NEW] every *_STATUS/*_MESSAGE pair (§3)
│           ├── policies/projects.policy.ts              [NEW] visibility + mutation matrix (§1.1), colocated spec
│           ├── entities/project.entity.ts               [REWRITE] Project + ProjectMember entities (uuid ids)
│           ├── factories/project.factory.ts             [REWRITE] row builders (randomUUID + timestamps)
│           ├── repositories/projects.repository.ts      [NEW] DRIZZLE queries, tx helpers, per-project advisory lock, 23505→conflict
│           ├── dto/create-project.dto.ts                [REWRITE] name / color / memberUserIds / leadUserIds
│           ├── dto/update-project.dto.ts                [REWRITE] hand-written optional name/color (drop PartialType stub)
│           ├── dto/add-project-member.dto.ts            [NEW] userId
│           ├── dto/set-project-lead.dto.ts              [NEW] isLead
│           ├── dto/projects-responses.dto.ts            [NEW] ProjectResponseDto + toProjectResponse()
│           ├── projects.controller.ts                   [REWRITE] §3 routes, per-route guards, Swagger
│           ├── projects.service.ts                      [REWRITE] orchestration + defense-in-depth re-checks
│           ├── projects.module.ts                       [REWRITE] imports AuthModule, DatabaseModule, MembersModule
│           └── projects.{service,controller}.spec.ts    [REWRITE] §8 test groups (Nest CLI stubs replaced)
```

**Frontend** (this pass — required for the feature to be usable)

```
Frontend/src/
├── lib/api.ts                              [EDIT] listProjects, getProject, createProject, updateProject,
│                                              deleteProject, addProjectMember, removeProjectMember,
│                                              setProjectLead + Project/ProjectMember types
├── lib/dashboard.ts                        [EDIT] remove demo projects from createDemoState() + Project fixture type
├── store/slices/projectsSlice.ts           [NEW] list cache + loading (mirrors membersSlice)
├── store/index.ts                          [EDIT] register slice
├── pages/DashboardPage.tsx                 [EDIT] fetch real projects; handlers → API + refresh;
│                                              canManageProjects = role ∈ {Admin, PM} gates every CTA
├── pages/ProjectDetailPage.tsx             [NEW] §6
├── router.tsx                              [EDIT] /dashboard/projects/:id route
├── components/dashboard/OrgView.tsx         [EDIT] real project data; "Open board" → navigate;
│                                              "+ New project" + empty-state CTA switch from
│                                              canManageMembers → canManageProjects (HR must not see them)
├── components/dashboard/NewProjectDialog.tsx      [NEW] name + color swatches + roster picker + lead toggles
├── components/dashboard/AddProjectMemberDialog.tsx [NEW] org-roster picker (ACTIVE, role ≠ HR, not already in)
└── components/dashboard/ProjectMemberTable.tsx     [NEW] shared member table for the detail page
```

## 6. Frontend flow

**Dashboard** — the 0/1/many project layouts already exist; they now render real data:

- List fetches via `projectsSlice`; avatars/counts/colors come from the API's `members` array.
- Gating flag changes: CTAs currently keyed on `canManageMembers` (Admin/HR/**PM**) must move to **`canManageProjects` = Admin | PM** — HR is read-only for projects.
- "Open board" → `navigate('/dashboard/projects/:id')`.
- **NewProjectDialog**: name, fixed color-swatch palette (server-validated hex), member checkboxes built from the org roster filtered to `status === 'ACTIVE' && role !== 'HR'`, lead toggle per selected member, client-side "at least one lead" validation mirroring the server rule; on success → refresh list + toast. 403/409 errors surface through the existing `ApiError → toast` path.

**ProjectDetailPage (`/dashboard/projects/:id`)**

- Header mirrors the single-project dashboard card: color spine, name, "Created by …", member count.
- Member table (avatar, name, email, org role, lead badge, added date) with controls per §1.1:
  - **Admin/PM (member)**: Add member (dialog), Remove per row (PM sees the button **only on Dev rows**), Lead promote/demote toggle. Sole-lead 403 → toast.
  - **HR/Dev**: no buttons at all (read-only).
  - Self row never shows Remove (403 `self_remove_forbidden` would fire anyway).
- Rename/recolor dialog + Delete (danger-zone pattern from org view) for Admin any / PM member.
- 404 → "Project not found or you don't have access" state with back link.

## 7. Edge cases (acceptance checklist)

1. Add a user with **no org membership** → **403 `not_org_member`** — API validates even though the UI picker can't produce it.
2. Add an **INVITED-but-not-accepted** org member → same **403** (must be ACTIVE first).
3. Add an **HR** user → **403 `project_member_role_forbidden`**.
4. Add an existing project member → **409 `already_project_member`**.
5. Create with **no/empty leads** → **400** validation; lead outside members ∪ {creator} → **400 `lead_not_member`**.
6. Create with HR/non-member in `memberUserIds` → **403** naming the offender.
7. Create with **no organization** → **409 `organization_required`** (`ActiveMemberGuard` is lenient org-less, so the service must check).
8. **Remove/demote the last lead** → **403 `last_lead_required`** under the per-project lock — **Admin included** (the invariant outranks oversight).
9. **Org-member removal while sole lead of ≥1 project** → **403 `project_last_lead_required`** (locks target's lead-projects sorted, re-counts).
10. Org-member removal while lead **with co-leads** → cascade removes only their row; ≥1 lead survives.
11. Org-member removal while plain member → cascade cleans all their project rows.
12. **Concurrent** lead removals (project path vs org path) → members-lock then sorted project-locks vs project-lock-only: acyclic lock order, lead count re-checked under both → exactly one wins, invariant holds.
13. **PM removes an Admin or peer PM** → **403 `project_remove_forbidden`**; PM removing a Dev who happens to be sole lead → invariant still **403** (rule precedence documented).
14. PM mutating a project they're **not in** → **404** (invisible before policy).
15. **HR/Dev any mutation** → **403 `role_forbidden`** (RolesGuard) + service re-check.
16. **Self-remove as Admin** → **403 `self_remove_forbidden`**.
17. **Creator removed from members** → loses visibility/management (404 afterwards); `created_by` credit remains on the card/detail.
18. PM removed from org → cascade ends their project access; blocked first if they're a sole lead (#9).
19. Duplicate project names → allowed (no constraint).
20. `PATCH {}` → **400 `empty_update`**; bad hex → **400**; invalid uuid param → **400**.
21. Invisible vs missing `:id` → indistinguishable **404** (no existence leak).
22. `addedByUserId` set `null` when the adder is removed — membership unaffected.
23. Org deleted → projects cascade away entirely.
24. Whitelist pipe strips smuggled fields (`isLead` on create, `organizationId` anywhere) — org is always the singleton, never client-chosen.
25. HR list works despite HR never being a member — visibility branch is role-based, not membership-based.
26. Lead toggle on an already-lead member with `isLead: true` (and vice versa) → 200 no-op, no transaction.
27. `GET /projects` for a Dev with zero project memberships → `{ projects: [] }` (empty, never 403/404).
28. Add the **creator** as a project member via `POST members` → **409 `already_project_member`** (auto-added at creation).
29. Removing a project's **last remaining member** is impossible unless they are a non-lead — a sole member who is also sole lead is protected by #8; a non-lead sole member may be removed, leaving a project with leads-only membership (allowed) or… leads are members too, so ≥1 member always remains while ≥1 lead exists.
30. Frontend roster picker for **INVITED org members** → filtered out client-side (`status === 'ACTIVE'`); server double-checks (#2).

## 8. Delivery order

1. Schema (`projects.ts` + `project-members.ts` + exports) → `npm run db:generate` / `npm run db:migrate`.
2. Projects module: constants → policy (§1.1 matrix) → entities/factory → repository (per-project advisory lock, 23505 mapping) → DTOs + response mappers → service → controller → module rewrite + **`app.module.ts` import fix**.
3. Members: sole-lead lock+check in `removeMember` tx → constant → service mapping → specs.
4. Backend specs green — groups: **(a)** visibility matrix (Admin/HR all, PM/Dev member-only), **(b)** mutation matrix (HR/Dev read-only, PM add-any-except-HR / remove-Dev-only, self-403), **(c)** last-lead invariant on both paths (project tx + org-removal tx, concurrent ordering), **(d)** org-member-only + HR-target + already-member validation, **(e)** controller guard/roles composition (mirror `members.controller.spec.ts` metadata tests). Full typecheck.
5. Frontend: `api.ts` → `projectsSlice` → `NewProjectDialog` → `DashboardPage`/`OrgView` wiring (incl. `canManageProjects` gating) → `ProjectDetailPage` + route + member management.
6. Root `npm run lint` + `npm run typecheck` (Biome), both apps build.
7. Conventional commits: `feat(projects): add projects module with leads and role-scoped access`, `feat(frontend): wire dashboard projects to the api`.
