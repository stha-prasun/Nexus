# Login + Session — Implementation Plan

**Status:** Implemented ✔ (see amendments below)
**Scope:** `POST /auth/login`, `POST /auth/logout` (this device or all devices), `GET /auth/me` + full frontend wiring with a placeholder `/dashboard`
**Target:** `Backend/src/module/auth/api` (existing folder), `Backend/src/main.ts`, plus `Frontend/src` wiring
**Session backend:** existing Redis `SessionService` (already built/tested, currently unused by any route), extended with a per-user session index (sorted set)

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Endpoints | `login`, `logout`, `me` only. **No generic `SessionAuthGuard`** — it lands with the first real protected API. |
| Session store | Redis via existing `SessionService`; cookie `nexus_sid`, httpOnly / sameSite=lax / secure env / path=/. |
| Unverified account | **403** `{ status: 'email_unverified', message }` — consistent with register's honest-response choice. Password is still verified *first* (see §4) so this only leaks to someone who knows the password. |
| Bad credentials | **Single generic 401** `{ status: 'invalid_credentials' }` for unknown-email *and* wrong-password, with a **dummy bcrypt compare** on unknown email to equalize timing. |
| Dummy hash | Built **eagerly at bootstrap** via a `DUMMY_HASH` DI provider (`useFactory`, async → awaited by Nest before `app.listen()`). A lazy build would make the first unknown-email request ~3× slower — a measurable hole. Rounds come from the existing `bcryptRoundsProvider` (`BCRYPT_ROUNDS` env, clamped 4–31), so register and the dummy hash share one config source by construction. Value: `bcrypt.hash(randomBytes(32).toString('hex'), rounds)` — hex **string**, never a Buffer. Specs provide it via `useValue` (no bcrypt cost in unit tests). |
| Remember me | 24h default, **7d when checked**. Both env-configurable: `SESSION_TTL_SECONDS` (default → 86400) and new `SESSION_REMEMBER_TTL_SECONDS` (default 604800). `SessionService.create()/setCookie()` gain an optional `ttlSeconds` param. |
| Re-login w/ valid sid | **Rotate**: create new sid → set cookie → best-effort destroy old (fixation defense; destroy failure is logged, never fails login). Rotation `DEL`s the old session and `ZREM`s it from the **old session's** user index (the old cookie can belong to a different user). |
| Logout variants | **Two buttons, two behaviors:** *Log out* (this device only — default) and *Log out everywhere* (`allDevices: true`). Logging out locally must never silently kill other devices. |
| Session index | `user:sessions:<userId>` is a **sorted set**, `score = session expiry epoch`, member = sid. Login `MULTI`s `SET` + `ZREMRANGEBYSCORE -inf <now>` (prune-as-you-go) + `ZADD` + `EXPIRE`. Revocation `ZREMs` **only the members it read** — never `DEL`s the index key wholesale (a racing login would otherwise survive un-indexed = unrevocable). ZSET also makes "list my sessions" and a per-user device cap (`ZCARD`) free later. |
| Redis writes | **`MULTI/EXEC`, not bare pipelines**, for session writes — a pipeline isn't atomic, and `exec()` resolves with `[err, result]` tuples that **must be inspected**. Login inspects and **throws 500** on any tuple error/`null` exec (never return success with an un-indexed session). Logout paths log failures and still return 200 (best-effort, consistent with §4). |
| Re-login w/ valid sid (fixation) | Fresh 32-byte sid always; the pre-login sid is never accepted as the new session. |
| Cookie parsing | Add **`cookie-parser`** (`^2.0.0`, Express 5 line — verify at install; fallback `1.4.7`), `app.use(cookieParser())` in `main.ts`. |
| CSRF | **SameSite=Lax only**. Lax blocks cookies on cross-site POSTs → covers login/logout. Documented residual risk; double-submit tokens deferred. |
| Sliding expiry | **Absolute TTL this pass.** `touch()` exists but correct sliding also requires re-issuing the cookie with a new maxAge — deferred (§12). |
| Multi-device | Multiple concurrent sessions allowed (sid-keyed store + per-user index); user can revoke one or all. |
| Brute force | Per-IP `@Throttle` **+ per-email Redis failure counter**: 10 failures / 15 min → 429 `{ status: 'too_many_attempts' }`, cleared on successful login. |
| Frontend state | Redux `authSlice` is a **cache of what the server said**; `GET /auth/me` re-establishes truth on every fresh page load (the `httpOnly` cookie is unreadable by JS, so Redux alone cannot know a session is still valid after refresh). |
| `me()` outcome model | Three-way: `Ok(user)` / `Anonymous` (401) / `Unreachable` (network, 5xx, or **8s `AbortController` timeout**). Only `Anonymous` may sign the client out; `Unreachable` keeps `unknown` + retry UI (§9). |
| `/me` "protection" | `/me` needs no guard — it *is* the auth check: it reads the cookie itself and answers 401 when the session is missing/invalid/expired/corrupt. Guards are for endpoints serving protected *data* (future work), not for the endpoint that reports authentication state. |
| Revocation visibility | Revocation is instant because `/me` reads Redis on every call — a revoked sid 401s on its very next request. |

**Pattern:** same layered controller → service → repository + entity conventions as register (§4 of `register-auth-plan.md`).

---

## 2. File tree

```
Backend/
├── main.ts                                  + app.use(cookieParser())
├── package.json                             + cookie-parser, + @types/cookie-parser (dev)
├── .env / .env.example                      SESSION_TTL_SECONDS=86400, + SESSION_REMEMBER_TTL_SECONDS,
│                                            + LOGIN_LOCKOUT_MAX=10, LOGIN_LOCKOUT_WINDOW_SECONDS=900
└── src/module/auth/
    ├── docs/login-auth-plan.md              ← this plan
    └── api/
        ├── auth.module.ts                   + dummyHashProvider (useFactory → DUMMY_HASH, injects BCRYPT_ROUNDS)
        ├── auth.controller.ts               + login/logout/me routes (Swagger + @Throttle + @Res passthrough)
        ├── auth.service.ts                  + login/logout/me orchestration, lockout helpers, DUMMY_HASH injected
        ├── auth.service.spec.ts             + login/logout/me/lockout cases (DUMMY_HASH via useValue)
        ├── auth.controller.spec.ts          + cookie set/clear, status codes, logout body/response shape
        ├── dto/login.dto.ts                 NEW — email + password + remember
        ├── dto/logout.dto.ts                NEW — allDevices? (optional)
        ├── dto/auth-responses.dto.ts        + LoginResponseDto, MeResponseDto, LogoutResponseDto { message, revoked }
        ├── constants/auth.constants.ts      + messages, DUMMY_HASH token, lockout keys/limits, LOGIN_THROTTLE
        └── session/
            ├── session.service.ts           create(user, ttlSeconds?) / setCookie(res, sid, ttlSeconds?)
            │                                + user-session ZSET helpers: indexOnLogin, unindexOnLogout,
            │                                  revokeAllForUser(userId) [public — password reset uses it later]
            ├── session.constants.ts         default TTL → 86400, + SESSION_REMEMBER_TTL_SECONDS,
            │                                + USER_SESSIONS_KEY_PREFIX / userSessionsKey(userId)
            └── session.service.spec.ts      + ttl-param, index-maintenance, revoke-all, MULTI-error cases

Frontend/src/
├── lib/api.ts                               + apiGet helper w/ 8s AbortController timeout,
│                                            + login(), logout(allDevices), me() → Ok | Anonymous | Unreachable
├── store/index.ts                           + register authSlice
├── store/slices/authSlice.ts                NEW — { status, user, bootstrapError }
├── components/auth/RequireAuth.tsx          NEW — unknown → spinner, unknown+bootstrapError → retry UI,
│                                            anonymous → /login
├── pages/DashboardPage.tsx                  NEW — placeholder: user info + "Log out" + "Log out everywhere"
├── pages/LoginPage.tsx                      real submit handler (replace stub at :53-56)
└── router.tsx                               + /dashboard (RequireAuth); authenticated users leaving
                                             / and /signup redirect only after status resolves
```

---

## 3. API contract

All routes under the `/api/v1` global prefix.

### 3.1 `POST /auth/login` — `@Throttle({ default: { limit: 10, ttl: 600_000 } })`

Body: `{ email, password, remember? }`

- `email`: `@IsString @NormalizeEmail @IsEmail @MaxLength(254)` (same rules as register)
- `password`: `@IsString @MinLength(1) @MaxLength(72)` — **no strength policy on login** (policy can change over time; existing passwords must still work)
- `remember`: `@IsOptional @IsBoolean` — no implicit conversion, so the frontend must send a real JSON boolean

Responses:

- **200** `{ user: { id, name, email, role } }` + `Set-Cookie` (maxAge = 24h, or 7d when `remember: true`)
- **401** `{ status: 'invalid_credentials', message }` — unknown email or wrong password (**byte-identical body**)
- **403** `{ status: 'email_unverified', message }` — correct password, unverified account (no session created, no cookie)
- **429** `{ status: 'too_many_attempts', message }` — per-email lockout or per-IP throttle hit
- **500** — session `MULTI/EXEC` failed or returned an error tuple (login must never succeed with an un-indexed session)

### 3.2 `POST /auth/logout` — `@HttpCode(200)`

Body (optional): `{ allDevices?: boolean }` — `LogoutDto`, `@IsOptional @IsBoolean`. Absent/false = this device; `true` = revoke every session for the authenticated user.

Response: **200** `{ message, revoked: number }` — always 200, **idempotent**, cookie always cleared.

- **This device:** read sid → `GET` → uid → `MULTI` (`DEL session:<sid>` + `ZREM user:sessions:<uid> <sid>`) → `revoked` = `DEL` count (0 or 1). Missing/expired/corrupt sid → `revoked: 0`, no Redis writes.
- **All devices:** requires a **valid session** (there is no uid without one). Missing/invalid sid → `revoked: 0` — the right security posture (an anonymous caller can't revoke anything) and the UI reads it as "already logged out" (§9).
- `exec()` tuple errors are logged; the response is still 200 with the cookie cleared (best-effort — an undestroyed key dies at TTL and **remains indexed**, so a later revoke-all can still reach it). Logout must never surface a 500 to the client.

### 3.3 `GET /auth/me`

- **200** `{ user: { id, name, email, role } }` — session snapshot, **0 Postgres reads**
- **401** `{ status: 'unauthenticated', message }` + stale cookie cleared — no/invalid/expired/corrupt sid
- **500** on Redis failure — a transient outage must **not** 401 (that would falsely sign users out client-side)

**Why `/me` exists (vs. storing user details in Redux at login):** the session cookie is `httpOnly`, so JS can never read it — Redux only knows a user is logged in because login told it. On a fresh load (refresh/new tab) Redux is empty while the cookie may still be valid. Persisting Redux to localStorage makes the client claim and the Redis session diverge (expired session + "authenticated" UI) and is spoofable (role in localStorage must never drive a security decision). `/me` re-establishes server truth on every fresh load: 1 Redis read, 0 Postgres. `RequireAuth` gates `/dashboard` on exactly this signal.

---

## 4. Login / logout / revoke flows (order is load-bearing)

### 4.1 Login

```
1. Normalize email via pipe.
2. Lockout check: GET auth:login:fail:<email> → count ≥ MAX → 429 (no bcrypt, no DB).
3. repo.findByEmail(email)                        ← 1 SELECT, unique index
4. bcrypt.compare(password, user.passwordHash ?? DUMMY_HASH)
   • user === null → compare against the eager DUMMY_HASH → timing equalization
   • mismatch → INCR fail counter (EXPIRE on first hit) → 401 invalid_credentials
5. match && !user.isVerified → 403 email_unverified  ← password checked BEFORE revealing verification state
6. DEL fail counter (success resets lockout)
7. sessions.create(snapshot, remember ? REMEMBER_TTL : TTL)
     MULTI/EXEC: SET session:<sid> + ZREMRANGEBYSCORE user:sessions:<uid> -inf <now>
                 + ZADD user:sessions:<uid> <expiry> <sid> + EXPIRE index (remember TTL)
     → inspect tuples: any error or exec() null → throw → 500
8. controller: sessionService.setCookie(res, sid, ttl)
9. Old sid cookie present? → GET session:<oldSid> → oldUid
     best-effort MULTI/EXEC: DEL session:<oldSid> + ZREM user:sessions:<oldUid> <oldSid>
     (use the OLD session's uid, never the new login's; failures logged, never fail login)
```

**Why this order:** checking the password before the verified flag means an attacker can't probe which emails are registered-unverified without the correct password. The 403 path still costs a real bcrypt compare.

**Why `ZREM` only on login's own sid:** the login write is a fresh `ZADD` — it never touches other members. The prune (`ZREMRANGEBYSCORE -inf <now>`) only removes **expired** scores, so a concurrent live session can't be collateral damage.

**Redis outage semantics:** session create failure → **500** (login genuinely failed; don't lie with a 200). Logout failure → logged, still 200. Me GET failure → 500, cookie untouched.

**Corrupt session JSON** (`JSON.parse` throws in `sessions.get`): destroy sid + unindex it (if uid recoverable), clear cookie, treat as unauthenticated (401).

### 4.2 Logout (this device)

```
1. sid from cookie → missing → clearCookie → 200 { revoked: 0 }
2. GET session:<sid> → null (dead/expired) → clearCookie → 200 { revoked: 0 }
     (its zset member, if still present, is cleaned by the next login's prune or any revoke-all)
3. uid = snapshot.userId → MULTI/EXEC: DEL session:<sid> + ZREM user:sessions:<uid> <sid>
     → inspect tuples (errors logged, never thrown)
4. clearCookie → 200 { message, revoked: <DEL result> }
```

### 4.3 Logout all devices (`allDevices: true`)

```
1. sid from cookie → missing/invalid → clearCookie → 200 { revoked: 0 }   ← requires a valid session
2. uid = snapshot.userId
3. ZRANGE user:sessions:<uid> 0 -1               ← read members (may include stale/expired sids)
4. MULTI/EXEC: for each READ sid: DEL session:<sid>
               + for each READ sid: ZREM user:sessions:<uid> <sid>
     → inspect tuples; revoked = sum of DEL results (live sessions actually destroyed)
5. clearCookie → 200 { message, revoked }
```

**Index is never `DEL`ed wholesale** — only the exact members from step 3 are `ZREM`ed, so a login racing between steps 3 and 4 lands its own `ZADD` and survives **still indexed**. (Redis auto-deletes the zset when its last member is removed, so the racing `ZADD` recreates it cleanly either way.) A Lua `EVAL` doing read+delete atomically is the noted alternative if this ever needs to be airtight against interleaved `ZREM`s; it isn't required for index correctness.

`SessionService.revokeAllForUser(userId): Promise<number>` is a **public method** — the controller path is just "valid session → uid → call it". Password reset later calls it directly with no refactor.

---

## 5. Query budget & N+1 policy

| Flow | Postgres | Redis | bcrypt |
|---|---|---|---|
| `POST /login` (success) | 1× SELECT by email | 1× GET (lockout) + 1× DEL (counter) + 1× **MULTI/EXEC** (SET + ZREMRANGEBYSCORE + ZADD + EXPIRE); rotation: +1× GET old sid + 1× MULTI/EXEC (DEL + ZREM) | 1 compare |
| `POST /login` (failure) | 1× SELECT | 1× GET + 1× INCR (+EXPIRE once) | 1 compare |
| `POST /logout` (this device) | 0 | 1× GET + 1× MULTI/EXEC (DEL + ZREM) | — |
| `POST /logout` (all devices) | 0 | 1× GET + 1× ZRANGE + 1× MULTI/EXEC (N× DEL + N× ZREM) | — |
| `GET /me` | **0** (snapshot) | 1× GET | — |

- **No N+1 by construction:** revoke-all is *one read* + *one `EXEC` round trip* carrying O(devices) commands — never a loop of round trips. Lockout keys hold the normalized email (same PII already in the `users` table); documented.
- **No new Postgres indexes** — login reuses `users_email_unique`; the session index and lockout live entirely in Redis.
- **Rotation adds one `GET`** (old session) — it's in the budget deliberately: revocation of the old sid needs its uid, and the uid must come from the *old* session.

---

## 6. Edge cases

| Case | Behavior |
|---|---|
| Unknown email | eager dummy bcrypt compare → 401 (indistinguishable from wrong password) |
| Wrong password | 401 + failure counter incremented |
| Correct password, unverified | 403 `email_unverified`, no session, counter **not** incremented |
| 10 failures within 15 min (per email) | 429 `too_many_attempts`; lockout check happens before any bcrypt |
| Successful login after failures | counter DEL'd |
| Login `MULTI/EXEC` tuple error or `null` exec | log + **500** — never success with an un-indexed session |
| Login with valid session cookie | rotate (new sid; old `DEL` + `ZREM` keyed by the **old** session's uid) |
| Rotation: old session belongs to a different user | old uid used → that user's index is the one trimmed (not the new login's) |
| Rotation: old session already gone | `GET` null → no-op; any orphaned zset member is pruned by the next login's `ZREMRANGEBYSCORE` |
| Rotation: old-session `DEL`/`ZREM` fails | logged; old session lives to TTL but **stays indexed** → a later revoke-all can still kill it |
| Login with stale/expired cookie | ignored; new cookie overwrites it |
| `remember` absent/false | 24h TTL |
| Logout with no cookie | 200 + `revoked: 0` + no Redis writes |
| Logout with expired sid | 200 + `revoked: 0` + cookie cleared |
| Logout `MULTI` tuple error | logged; 200; cookie cleared; key survives to TTL but stays indexed |
| Logout Redis down | 200 + logged + cookie cleared (key expires at TTL) |
| `allDevices: true`, dead/missing session | 200 `revoked: 0` (no uid → nothing revocable; UI reads "already logged out") |
| Revoke-all racing a concurrent login | racing `ZADD` after our `ZRANGE` survives **and stays indexed** (only read members are `ZREM`ed; index key never `DEL`ed wholesale) |
| Stale zset members | pruned by `ZREMRANGEBYSCORE` on **every login**; a user who never returns leaves one zset that dies with its own `EXPIRE` (refreshed to remember-TTL on last login) — no unbounded growth |
| `/me` with corrupt session payload | unindex (if uid recoverable) + clear cookie + 401 |
| `/me` Redis down | 500, cookie untouched |
| `/me` hung connection (client) | frontend `AbortController` timeout ~8s → `Unreachable` state, no infinite spinner |
| Malformed/oversized cookie value | sid treated as invalid (miss) — key is `session:<sid>` from a fixed prefix, never interpolated unsanitized |
| bcrypt hash unreadable in DB (corrupt row) | compare throws → log error → 401 (don't 500-hint at DB state) |
| ValidationPipe, non-boolean `remember`/`allDevices` | 400 (no implicit conversion — consistent with the global pipe) |
| Cross-site POST with Lax cookie | cookie not sent → treated as anonymous (CSRF mitigation working) |

---

## 7. Security pass

- **Enumeration:** the 401 body is byte-identical for unknown-email vs wrong-password; the eager dummy compare equalizes timing with no first-request anomaly (built during module init, before `listen`). The 403 unverified path requires the correct password — same leakage register already accepts, no worse.
- **Timing:** `DUMMY_HASH` provider injects `BCRYPT_ROUNDS` from the same source register uses — cost always matches real hashes; no constant-literal drift if the env changes.
- **Fixation:** always mint a fresh 32-byte sid on successful login; never accept the pre-login sid.
- **Revocation:** `POST /auth/logout` is server-side invalidation (`DEL`, not just a cookie clear) — instant, because `/me` reads Redis per request. `allDevices: true` kills every session for the user and is only reachable with a valid session (an anonymous caller gets `revoked: 0`). This is the user-facing remedy for a stolen/leaked cookie. `SessionService.revokeAllForUser(userId)` is exposed for password reset to reuse later.
- **Index safety:** the user-session key is never `DEL`ed wholesale — revocation `ZREM`s only what it read, so revocation can't *create* an unrevocable session. Login `MULTI`s are inspected so a half-applied write fails loudly (500) instead of silently.
- **Lockout DoS tradeoff:** an attacker can lock a victim's email for ≤15 min — accepted; threshold (10) and the per-IP throttle (10/10 min) bound the blast radius. Documented.
- **Cookies:** unchanged flags (httpOnly, lax, secure env, path=/). CSRF relies on Lax + the CORS allowlist + `credentials: true`; residual risk (top-level GET navigations carry cookies) is read-only-safe: `/me` is a pure read, logout is a POST.
- **Secrets:** `passwordHash` never leaves the repository→service boundary; the session snapshot holds only `{ userId, role, name, email, createdAt }`. Passwords and sids never logged.
- **Throttling:** login 10/10 min/IP on top of the global 100/min.
- **Client state:** the Redux slice mirrors server responses only — never used as the authority for authentication (that's `/me`) and never trusted for authorization.

---

## 8. Env additions / changes (`.env` / `.env.example`)

```bash
# --- Sessions ---
SESSION_COOKIE_NAME=nexus_sid
SESSION_TTL_SECONDS=86400            # CHANGED default: 24h (was 604800)
SESSION_REMEMBER_TTL_SECONDS=604800  # NEW: "remember me" = 7d
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAME_SITE=lax

# --- Login lockout (per email, Redis) ---
LOGIN_LOCKOUT_MAX=10                 # NEW
LOGIN_LOCKOUT_WINDOW_SECONDS=900     # NEW
```

⚠️ The existing `.env` has `SESSION_TTL_SECONDS=604800` explicitly set — it must be updated to `86400` or it overrides the new default.

---

## 9. Frontend

- **`lib/api.ts`:** add an `apiGet` helper (mirrors `apiPost`, `credentials: 'include'`, **`AbortController` with ~8s timeout** → aborted/failed fetch surfaces as `Unreachable`, never a hang).
  - `login({email,password,remember}) → { user }`
  - `logout({ allDevices } = {}) → { message, revoked }`
  - `me()` returns a three-way result instead of throwing on 401:

    | Result | Meaning |
    |---|---|
    | `Ok(user)` | 200 |
    | `Anonymous` | 401 — definitive; signing out the client is correct |
    | `Unreachable` | network error, 5xx, or timeout — **not** a verdict on the session |

- **`authSlice.ts`:** `{ status: 'unknown' | 'loading' | 'authenticated' | 'anonymous', user: User | null, bootstrapError: boolean }`; reducers `setUser`, `setAnonymous`, `markLoading`, `setBootstrapError`. Plain dispatch from components — no `createAsyncThunk` (matches the repo's simplicity).
- **Bootstrap:** a session-gate effect in `main.tsx` (or `RootProviders`): on mount `me()` → dispatch; runs once per full page load:

  | `me()` result | Redux | UI |
  |---|---|---|
  | `Ok` | `authenticated` + user | `/dashboard` renders |
      | `Anonymous` | `anonymous` | `RequireAuth` redirects `/` (the index login page) |
  | `Unreachable` | stays `unknown` + `bootstrapError` | `RequireAuth` shows *"Can't reach the server"* + **Retry** (re-runs `me()`) — never silently bounces a possibly-logged-in user to `/login` |

- **`RequireAuth.tsx`:** `unknown`/`loading` → spinner; `unknown` + `bootstrapError` → retry UI; `anonymous` → `<Navigate to="/" replace>` (the login page is the index route — there is no separate `/login` path); `authenticated` → children. Wraps `/dashboard`.
- **Redirects off `/` and `/signup`:** fire **only on `status === 'authenticated'`** — never while status is still resolving (`unknown`). `/login` itself stays fully usable while status is `unknown` + `bootstrapError` (the retry affordance lives with `RequireAuth`, not on the login page — a fresh login is always a valid recovery path).
- **`LoginPage.tsx`:** replace the stub at `:53-56` — call `login()`, dispatch `setUser`, `navigate('/dashboard')`; error mapping: `ApiError.status` 401 → show message; 403 `email_unverified` → `navigate('/confirm-sent', { state: { email } })` (reuses the existing page + resend cooldown); 429 → show server message; status 0 → network copy; `triggerShake()` on all failures. `remember` checkbox → payload.
- **`DashboardPage.tsx`:** minimal placeholder (name/email/role from the slice) + **two explicit actions:**
  - *Log out* → `logout()` (this device only) → dispatch `setAnonymous` → navigate `/`
  - *Log out everywhere* → `logout({ allDevices: true })` → if `revoked === 0`, treat as already logged out (same UX) → clear state → navigate `/` (owner preference over `/login`)
- **`router.tsx`:** add `/dashboard` under `RequireAuth`; authenticated users hitting `/` or `/signup` redirect to `/dashboard` (only once status resolves).
- Google button + "Forgot password?" stay dead (out of scope).

---

## 10. Tests

Unit (colocated `.spec.ts`, `TestingModule` + `useValue` mocks, matching register style):

- **`auth.service.spec.ts`** — login: success (fresh sid, remember TTL chosen, rotation destroys old sid using the **old** session's uid), unknown email (`DUMMY_HASH` via `useValue` compared, 401), wrong password (401 + INCR), unverified + correct password (403, no session created), lockout exceeded (429, no bcrypt), counter cleared on success, session `MULTI/EXEC` tuple error → throws 500, rotation `GET` miss → no-op; logout: destroys + unindexes, dead sid → `revoked: 0`, `exec` error → still resolves, `allDevices` dead session → `revoked: 0`, `allDevices` happy path → `revoked: N`; me: snapshot returned, null on miss, corrupt JSON → unindex + clear + null.
- **`auth.controller.spec.ts`** — login sets cookie with correct maxAge; logout accepts optional body, always clears + 200 with `{ message, revoked }`; me 401 clears stale cookie; delegation.
- **`session.service.spec.ts`** — `create`/`setCookie` with explicit ttl param (default now 86400); login write does `SET` + `ZREMRANGEBYSCORE` + `ZADD` + `EXPIRE` in one `MULTI` and **inspects tuples**; logout `ZREM`s its own member; `revokeAllForUser` returns the live-destroyed count and `ZREM`s **only read members** (never `DEL`s the index key); `MULTI` tuple error → rejects on the login path; index key survives with a racing member.
- **`auth.module.spec` (if present) / provider wiring** — `DUMMY_HASH` factory injects `BCRYPT_ROUNDS` and yields a bcrypt-format hash (mocked bcrypt).

Gates: `npm run lint`, root `npm run typecheck`, Backend `npm test`. The frontend has no test runner — manual smoke checklist (§11 step 10).

---

## 11. Build order (execution steps)

1. Write this plan to `auth/docs/login-auth-plan.md` (incl. amendments) ✔ this file.
2. Install `cookie-parser` + `@types/cookie-parser`; verify against Express 5 / Nest 11; `app.use(cookieParser())` in `main.ts`.
3. Session layer: TTL split (`create`/`setCookie` ttl params) + user-session ZSET helpers (`indexOnLogin`/`unindexOnLogout`/`revokeAllForUser`) with `MULTI`+tuple inspection + specs; update `.env` / `.env.example` (§8).
4. Constants + `DUMMY_HASH` provider in `auth.module.ts` (injects `BCRYPT_ROUNDS`).
5. DTOs: `LoginDto`, `LogoutDto`, response DTOs (incl. `revoked`).
6. `AuthService`: login (§4.1 order), logout (§4.2), `allDevices` revoke (§4.3), lockout helpers, `DUMMY_HASH` injected.
7. Controller: 3 routes, Swagger, `@Throttle`, `@Res passthrough`.
8. Backend tests (§10) → lint → typecheck → `npm test`.
9. Frontend: `api.ts` (three-way `me()`, 8s timeout) → `authSlice` → store wiring → `LoginPage` → `RequireAuth` (incl. retry state) + `DashboardPage` (two buttons) → `router.tsx` + bootstrap.
10. Manual smoke: register → verify → login (both TTLs) → `/me` via curl with a cookie jar → logout (`revoked: 1`) → `/me` 401; two sessions → `allDevices: true` kills both; dead-cookie logout → `revoked: 0`; unverified login → 403; 11 rapid failures → 429; frontend full loop incl. refresh on `/dashboard`, Redis-down bootstrap → retry UI (stop Redis container → reload → retry after start).
11. Update `register-auth-plan.md` §13 (remove login from "out of scope") — one-line doc touch.

---

## 12. Explicitly out of scope (follow-ups)

- Generic `SessionAuthGuard` / protecting real APIs (next feature).
- Sliding TTL (`touch()` + cookie re-issue on `/me`).
- Forgot/reset password flow ("Forgot password?" stays dead) — when built, call `SessionService.revokeAllForUser(userId)` after a reset.
- Session list UI ("your devices") and per-user device cap (`ZRANGE`/`ZCARD` on the existing index — free, no schema change).
- Google OAuth button.
- Double-submit CSRF tokens.
- Frontend unit tests (no runner installed).
- Lua `EVAL` for atomic read+delete in revoke-all (only needed if interleaved `ZREM`s become a concern; index correctness doesn't require it).

---

## 13. Implementation amendments

- **Dashboard (§2 / §9):** `DashboardPage.tsx` was no longer empty by implementation time — a static demo dashboard (AppShell, org/member views) landed after this plan was written. Per the owner's call, it was **kept** and wired instead of replaced: `/dashboard` + `/profile` sit under `RequireAuth`, the sidebar *Log out* is a real this-device logout, the profile page's *Log out everywhere* is a real `allDevices: true` revoke, and the shell shows the authenticated user's name/email. The per-device *Log out* in the demo session list stays stubbed (needs the session-list API, §12).
- **Session helpers:** `indexOnLogin` / `unindexOnLogout` were folded into `SessionService.create` (MULTI write) and `destroyAndUnindex` rather than exposed as separate methods — one call site each, no value in splitting.
- **429 exception:** Nest has no `TooManyRequestsException`; the lockout throws `HttpException(body, 429)` with the same `{ status: 'too_many_attempts' }` body.
- **cookie-parser:** npm's latest is `1.4.7` (the plan's fallback); works fine on the Express 5 / Nest 11 line.
