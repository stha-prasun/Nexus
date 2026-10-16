# Admin Seed Script — Implementation Plan

**Status:** Approved for implementation (not yet implemented)
**Scope:** One standalone script provisioning the first `Admin` account from env credentials
**Target:** `Backend/scripts/seed-admin.ts` (new folder) + `package.json` + env files

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Idempotency | **Upsert** on `users.email`: existing account gets password, name, `role='Admin'`, and re-verification overwritten; otherwise insert. Safe to re-run. |
| Credentials | Env-only, no CLI args, nothing hardcoded: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (both required), `SEED_ADMIN_NAME` (optional, default `Admin`). Placeholders live in `.env` / `.env.example`. |
| Email verification | **Skipped by design** — `email_verified_at` set to `now()` at seed time. No token, no Redis, no mail. Admin must be able to log in immediately. |
| Password hashing | bcrypt, same library and cost as `UserFactory`: `bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS ?? 12))`, clamped 4–31. |
| Data hygiene | Email normalized in-script (trim + lowercase) — DTO normalizers don't run outside HTTP (`register-auth-plan.md` §… raw callers must clean data themselves). Password taken verbatim from env (operator-controlled). |
| DB access | Plain `pg` Pool + raw SQL. No Nest bootstrap, no DI container, no drizzle schema imports — the script must not break when app internals move. |
| Connection | `POSTGRES_HOST_PORT` (direct server port, same as drizzle-kit) — avoids PgBouncer transaction-mode quirks; the app's `POSTGRES_PORT` (6432) stays untouched. |
| Runner | `ts-node` (existing devDep): `"seed:admin": "ts-node scripts/seed-admin.ts"`. CJS `nodenext` mode allows extensionless relative imports; fallback `-T` (transpile-only) only if ts-node complains. |
| Failure mode | Missing env → exit 1 with a message naming the missing vars. Any DB/bcrypt error → log + exit 1. Never partial-state (single statement). |

## 2. Env contract

```
SEED_ADMIN_EMAIL=admin@nexus.dev
SEED_ADMIN_PASSWORD=ChangeMe123!
SEED_ADMIN_NAME=Admin
```

- Added to both `Backend/.env` (placeholders, operator edits) and `Backend/.env.example` (documentation).
- Reuses existing `BCRYPT_ROUNDS`, `POSTGRES_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST_PORT`.
- `dotenv/config` loaded first in the script (same pattern as `src/main.ts`).

## 3. File tree

```
Backend/
├── scripts/                       ← NEW folder (no existing precedent)
│   └── seed-admin.ts              the seed script (below)
├── package.json                   + "seed:admin": "ts-node scripts/seed-admin.ts"
├── .env                           + SEED_ADMIN_* placeholders
└── .env.example                   + SEED_ADMIN_* documentation
```

## 4. Script logic (`scripts/seed-admin.ts`)

1. `import 'dotenv/config'`.
2. Read + validate env: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` required (exit 1 listing any missing); `SEED_ADMIN_NAME ?? 'Admin'`; `BCRYPT_ROUNDS` default 12, clamped 4–31 (mirror `auth.module.ts`).
3. Normalize email: trim + lowercase.
4. `pool = new Pool({ host, port: POSTGRES_HOST_PORT, user, password, database })`.
5. `hash = await bcrypt.hash(password, rounds)`.
6. Single atomic statement — no pre-SELECT needed:

   ```sql
   INSERT INTO users (email, name, role, password_hash, email_verified_at)
   VALUES ($1, $2, 'Admin', $3, now())
   ON CONFLICT (email) DO UPDATE
   SET password_hash     = EXCLUDED.password_hash,
       name              = EXCLUDED.name,
       role              = 'Admin',
       email_verified_at = now()
   RETURNING id, email, name, role;
   ```

   (`xmax = 0` on the returned row distinguishes insert from update — used only for the log line.)
7. Log: `Admin seeded: <email> (created|updated)`.
8. `finally { await pool.end(); }` — always close, always exit non-zero on error.

## 5. Explicitly out of scope

- Creating the organization — the seeded Admin does that in the UI on first login (`EmptyOrgView`).
- Seeding HR / PM / Dev — those roles stay self-registerable.
- Tests — standalone ops script; jest `rootDir` is `src/`, nothing to hook into. Verification is operational (below).
- Env schema/validation refactor — script validates its own vars ad hoc, consistent with the rest of the codebase.

## 6. Verification

1. `npm run seed:admin` in `Backend/` → row created with `role='Admin'`, `email_verified_at` set.
2. Re-run → log says `updated`, still exactly one row for that email.
3. Frontend login as the seeded Admin → dashboard reaches `EmptyOrgView` (not the no-org view).
4. `npm run lint` + `npm run typecheck` pass in `Backend/`.
