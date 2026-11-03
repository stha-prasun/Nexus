# Object Storage (MinIO / S3 / Local disk) — Implementation Plan

> Env-configurable object storage with **three drivers**: **MinIO**, **any
> S3** (Amazon S3 or another S3-compatible store), or **the server's own
> disk** (`/uploads`, files received via multer). Client code lives in a new
> leaf module `Backend/src/module/storage/` mirroring `module/redis/`.
> Companion to `documents-plan.md` (which it supersedes in part — see §9).
> **No commits, no pushes** during this work.

---

## §1 Decisions (confirmed)

| Concern | Decision |
|---|---|
| Placement | New leaf `src/module/storage/` mirroring `module/redis/` (factory + token + service, explicit imports). `common/` stays observability-only (logger/tracing/metrics/middleware) — external I/O clients belong in leaf modules, per the redis precedent. |
| Client SDK | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for the remote drivers. MinIO reached via `endpoint` + `forcePathStyle: true`; AWS S3 via region/creds or the SDK default credential chain. The `local` driver needs no SDK — `node:fs/promises`. |
| Driver selection | `STORAGE_DRIVER=minio\|s3\|local` env var — **three options**. |
| Local storage | `STORAGE_DRIVER=local` stores files on the server disk under `/uploads` (relative `uploads/` by default, configurable). Uploads arrive through **multer** for every driver; see §5 design note. |
| `minio` npm package | **Removed** after migration — nothing imports it (health probe, tracing types, e2e all move off it). |
| Bucket | `STORAGE_BUCKET` env, default `nexus-documents`, private, auto-created on boot (remote drivers only). |
| `/uploads` exposure | **Never** served statically (`express.static`) — files are reachable only through the authenticated download route (§5). |

Why aws-sdk over minio-js (already discussed): canonical AWS SDK, first-class
AWS features and virtual-host style; the cost is rewriting the tracing patch
(§7) and moving the health probe (§6) — both done here.

---

## §2 Env configuration (`.env.example` additions)

```dotenv
# --- Object storage -------------------------------------------------------
# Driver: minio (self-hosted MinIO) | s3 (Amazon S3 / any S3) | local (server disk)
STORAGE_DRIVER=minio
STORAGE_PRESIGN_TTL_SECONDS=300

# STORAGE_DRIVER=minio — builds the endpoint (defaults = docker-compose)
MINIO_ENDPOINT=localhost          # existing
MINIO_API_PORT=9000               # existing
MINIO_USE_SSL=false               # NEW
MINIO_ROOT_USER=nexus             # existing
MINIO_ROOT_PASSWORD=nexus_minio_password  # existing
MINIO_REGION=us-east-1            # NEW (S3-compatible stores require a region)

# STORAGE_DRIVER=s3
S3_ENDPOINT=                      # NEW — optional; e.g. https://s3.amazonaws.com (empty ⇒ AWS default)
S3_REGION=us-east-1               # NEW
S3_ACCESS_KEY_ID=                 # NEW — empty ⇒ SDK default chain (env → profile → IAM role)
S3_SECRET_ACCESS_KEY=             # NEW
S3_FORCE_PATH_STYLE=true          # NEW — false = AWS virtual-host; true = MinIO/compat stores

# Shared (remote drivers) — bucket name, auto-created on boot
STORAGE_BUCKET=nexus-documents

# STORAGE_DRIVER=local — server disk; files land in <STORAGE_LOCAL_DIR>/<object-key>
STORAGE_LOCAL_DIR=uploads         # NEW — relative to process cwd (Backend/uploads); made absolute at boot
```

Rules:

- Existing `MINIO_*` keys keep their names (backward compatible with current
  `.env` files); `MINIO_CONSOLE_PORT` stays compose-only (console UI, not the
  client).
- All defaults mirror `Backend/.env` and `docker-compose.yml`, so
  `docker compose up -d` + `npm start` works with no `.env` present — the
  same convention `redis.module.ts` and `health.module.ts` already use.
- Docker-compose `minio` service and the `ready` gate stay as-is (local dev
  still runs MinIO; aws-sdk talks to it at `localhost:9000`).
- `STORAGE_LOCAL_DIR` is ignored by the remote drivers; `MINIO_*`/`S3_*`/
  `STORAGE_BUCKET` are ignored by `local`.
- Add `uploads/` to `Backend/.gitignore` (the folder must never be committed).

---

## §3 Module structure

```
Backend/src/module/storage/
├── storage.module.ts              ← leaf: S3Client factory (remote drivers only)
│                                      + StorageService; exports StorageService
│                                      (+ STORAGE_CLIENT)
├── storage.service.ts             ← ensureBucket/mkdir, put, resolveDownload,
│                                      remove, probe (+spec)
├── constants/storage.constants.ts ← STORAGE_CLIENT token, StorageDriver type,
│                                      defaults (driver, bucket, TTL, local dir)
├── config/storage.config.ts       ← pure env resolver: driver, endpoint/creds,
│                                      local dir, fail-fast (+spec)
└── (flat — no api/, no controllers, like redis)
```

**Relationship to the documents module** (per `documents-plan.md` §3): the
documents module keeps its own `api/storage/` folder — `documents.storage.ts`
holds *document-specific* policy (object-key scheme
`projects/<projectId>/<uuidv4>.<ext>`, SVG/attachment disposition) and
delegates I/O to the generic `StorageService`. The leaf module knows nothing
about projects or documents.

Dependency direction (documented in module JSDoc, like `RedisModule`):
`StorageModule → (nothing)` — leaf. Consumers: `HealthModule`,
`DocumentsModule`, `AppModule` (boot-time ensureBucket/mkdir runs via
`StorageService.onModuleInit`).

The `S3Client` provider factory only builds a client when
`driver !== 'local'` (local needs no SDK client); `STORAGE_CLIENT` is
provided as `null`/absent for `local` — `StorageService` never touches it on
that path (spec'd in tests).

---

## §4 Driver resolution (`storage.config.ts`)

Pure function `resolveStorageConfig(env)` →

```ts
{
  driver: 'minio' | 's3' | 'local',
  bucket: string,                  // remote drivers only
  presignTtlSeconds: number,
  clientOptions?: S3ClientConfig,  // endpoint, region, forcePathStyle, credentials
  localDirAbs?: string,            // local driver only — path.resolve(cwd, STORAGE_LOCAL_DIR)
}
```

| Driver | Endpoint / target | forcePathStyle | Credentials |
|---|---|---|---|
| `minio` | `http(s)://MINIO_ENDPOINT:MINIO_API_PORT` (URL parsed) | `true` | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| `s3` | `S3_ENDPOINT` parsed if set, else SDK AWS default (virtual-host) | `S3_FORCE_PATH_STYLE` | explicit keys if set, else **`undefined` → SDK default chain** (env → shared profile → IMDS; IAM roles work in prod) |
| `local` | `path.resolve(process.cwd(), STORAGE_LOCAL_DIR)` | — | — |

Endpoint parsing for `S3_ENDPOINT` / `MINIO_*`: accept full URLs
(`https://s3.amazonaws.com`, `http://localhost:9000`) — split into protocol,
host, port for the SDK's `{ endpoint, forcePathStyle, tls }` options; a bare
host implies https.

**Fail-fast at boot** (throw with a clear message, following
`scripts/seed-admin.ts`'s `requiredEnv` spirit):

- `STORAGE_DRIVER` ∉ `{minio, s3, local}` → throw (typo in env must not
  silently fall back)
- `s3` + malformed `S3_ENDPOINT` URL → throw
- `local` + empty `STORAGE_LOCAL_DIR` → throw
- `STORAGE_BUCKET` empty (remote drivers) → throw

---

## §5 StorageService API

```ts
type DownloadResolution =
  | { kind: 'redirect'; url: string; expiresInSeconds: number }   // minio / s3
  | { kind: 'file'; absolutePath: string };                       // local

@Injectable()
class StorageService implements OnModuleInit {
  get driver(): StorageDriver;

  onModuleInit(): Promise<void>
    // minio/s3: HeadBucket → CreateBucket on NotFound (idempotent; ignore
    //           BucketAlreadyOwnedByYou)
    // local:    fs.mkdir(localDirAbs, { recursive: true })

  put(key: string, body: Buffer, opts: { contentType: string; contentLength: number }): Promise<void>
    // minio/s3: PutObjectCommand — network span (§7)
    // local:    mkdir parent dir + fs.writeFile(<localDirAbs>/<key>, body)
    //           (no span — fast local I/O)

  resolveDownload(key: string, contentDisposition: string): Promise<DownloadResolution>
    // minio/s3: getSignedUrl(client, GetObjectCommand({ Bucket, Key,
    //            ResponseContentDisposition: contentDisposition }),
    //            { expiresIn: presignTtlSeconds })
    //            → { kind: 'redirect', url, expiresInSeconds }  (local signing,
    //              no network, no span)
    // local:    path traversal guard — resolved path MUST stay under
    //            localDirAbs (key comes from the DB but is never trusted);
    //            fs.stat → ENOENT ⇒ throw document_file_missing
    //            → { kind: 'file', absolutePath }

  remove(key: string): Promise<void>
    // minio/s3: RemoveObjectCommand — network span
    // local:    fs.unlink (ENOENT ignored — idempotent)

  probe(): Promise<void>
    // minio/s3: ListBucketsCommand — network span
    // local:    fs.access(localDirAbs, W_OK)
}
```

- **Disposition policy** (SVG ⇒ `attachment`, others `inline`, RFC 5987
  filename encoding) is built by documents' `documents.storage.ts` and passed
  into `resolveDownload` — for remote drivers it becomes the presigned
  `ResponseContentDisposition`; for `local` the controller sets it as the
  response header. The leaf stays generic.
- **Download contract** (documents routes, per `documents-plan.md` §4):
  - `GET /projects/:id/documents/:docId/download` → **200 JSON**
    `{ url, expiresInSeconds }`:
    - remote drivers → absolute presigned URL, `expiresInSeconds = 300`
    - `local` → **relative** API path
      `/api/v1/projects/:id/documents/:docId/download/content`,
      `expiresInSeconds = 0`
  - `GET /projects/:id/documents/:docId/download/content` → streams the file
    (200, `Content-Type` from the DB row, `Content-Disposition` from the
    same policy). Active **only when `driver === 'local'`** (else 404);
    fully guarded (SessionAuthGuard + ActiveMemberGuard + `requireVisible`)
    like every other route. Missing file on disk → 404
    `document_file_missing`.
  - Frontend opens `url.startsWith('http') ? url : new URL(url, API_BASE)`
    — one code path for all three drivers.
  - Remote downloads still hit MinIO/S3 **directly** from the browser (signed
    URL); `local` downloads stream through Nest (Node bandwidth, acceptable
    for the local driver).
- The browser never sees `/uploads` as a static path — only via the guarded
  content route (§1, §7).

### Design note — multer's role

All three drivers share **one intake**: multer (`FileInterceptor('file')`,
`memoryStorage`, `limits: { fileSize: 25 MB, files: 1 }`) parses the
multipart body; the validation pipeline (`documents-plan.md` §5 — size,
extension, MIME, magic bytes, filename) runs on the in-memory buffer
**before anything is stored**; only then does `StorageService.put` dispatch —
`minio`/`s3` → `PutObject`, `local` → `fs.writeFile` into `/uploads/<key>`.

multer's `diskStorage` writing straight into `/uploads` was considered and
**rejected**: it would save the RAM buffer but split the pipeline —
validation would run *post-write* with unlink-on-reject, per-driver branches
in the controller, and rejected files would briefly exist on disk. The
uniform memory intake keeps validate-before-touch-disk and a single code
path (the 25 MB buffer was already accepted for the remote drivers).

---

## §6 Health probe migration

- `health.module.ts`: drop the `MINIO_CLIENT` factory + `minio` import;
  `imports: [..., StorageModule]`.
- `health.repository.ts`: inject `StorageService`, call `probe()` instead of
  `minio.listBuckets()`; timing stays in the repository's existing `timed()`.
  `probe()` covers all three drivers (remote → `ListBuckets`, local → dir
  writable).
- Health report key **stays `minio`** — API shape and
  `test/app.e2e-spec.ts` assertions (`checks.minio.status`) unchanged; the
  name reads as the object-storage check (rename to `checks.storage` listed
  in §12).
- `health/constants/health.contants.ts`: `MINIO_CLIENT` token deleted —
  token now lives in `storage/constants/storage.constants.ts`.
- e2e: `overrideProvider(StorageService).useValue({ probe: jest.fn() })`
  instead of overriding the raw client.
- `health.repository.spec.ts` + `health.module` wiring updated to match.

---

## §7 Tracing migration

- **Remove** `instrumentMinio()`, its call site (line ~126), and the
  `import type { Client as MinioClient } from 'minio'` +
  `MINIO_CLIENT` import from `common/tracing/instrumentation.service.ts`.
  Postgres/redis patches untouched.
- **Replace** with a `send()` wrapper inside `StorageService`: every network
  command (PutObject, RemoveObject, ListBuckets, Head/CreateBucket) runs
  inside `tracing.begin('minio', label)` — e.g. `minio PUT projects/…`,
  `minio LIST buckets` — mirroring the existing `handle.run()` +
  `handle.end(error)` pattern.
- **`local` driver produces no spans** (fs ops are fast; nothing to gain in
  the waterfall).
- **Span system stays `'minio'`** (`trace-context.ts` `SpanSystem`,
  metrics DTO copy "postgres, redis, minio", waterfall examples) — zero
  changes to metrics/tracing contracts; the label means object storage.
- Rationale: patching aws-sdk v3 internals (smithy `NodeHttpHandler`) is
  fragile across versions; the `send()` wrapper is ~10 lines and fully owned.
- Presign produces no span (local signing, no I/O).

---

## §8 Dependency changes

- **Add:** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- **Remove:** `minio` (only after §6 + §7 land and nothing imports it)
- **No new dep for `local`** — `node:fs/promises` + existing multer
  (`@nestjs/platform-express` ships it transitively; the documents module
  already uses `FileInterceptor`).
- Node v22 already satisfies aws-sdk v3 (no `engines` constraint to update).

---

## §9 Cross-plan updates to `documents-plan.md`

The storage plan supersedes parts of the documents plan — apply when both
land:

- **§2** MinIO layout: bucket name → `env('STORAGE_BUCKET', 'nexus-documents')`;
  add the `local` layout (`<STORAGE_LOCAL_DIR>/<object-key>`, same key
  scheme) and the `/uploads` gitignore + never-static rule.
- **§3** MinIO-client paragraph: replace "move factory to
  `src/module/minio/minio.module.ts`" → leaf is `src/module/storage/` (this
  plan); documents' `api/storage/` keeps only the document-specific wrapper.
- **§4** endpoints: download row → JSON `{ url, expiresInSeconds }` for all
  drivers (remote = presigned absolute URL; `local` = relative
  `.../download/content` path) **plus** the new guarded
  `GET .../download/content` row (local driver only).
- **§5** presign mention → `StorageService.resolveDownload` with
  `contentDisposition` supplied by `documents.storage.ts`; note multer
  intake is shared by all three drivers (§5 design note above).
- **§6** frontend download → open `url` as-is when absolute, else resolve
  against `API_BASE` (`new URL(url, API_BASE)`).
- **§7** security checklist: presign TTL now `STORAGE_PRESIGN_TTL_SECONDS`;
  add "`/uploads` is never exposed statically; `local` content route is fully
  guarded + traversal-checked".

---

## §10 Test plan

- **`storage.config.spec.ts`** — minio defaults; s3 with/without endpoint;
  URL parsing (protocol, port, bare host); invalid driver throws; malformed
  endpoint throws; empty bucket throws (remote); empty `STORAGE_LOCAL_DIR`
  throws; s3 empty-creds ⇒ default chain (credentials undefined); local
  `localDirAbs` resolved against cwd; bucket/TTL defaults.
- **`storage.service.spec.ts`** — mocked `S3Client.send` for remote; real
  temp dirs (via `STORAGE_LOCAL_DIR` override) for local:
  - ensureBucket: HeadBucket ok / NotFound → CreateBucket / already-owned
    ignored
  - local init: `mkdir` recursive
  - put: remote → correct PutObjectCommand params; local → file bytes land
    at `<dir>/<key>` (nested key creates parent dirs)
  - resolveDownload: remote → mocked presigner, `expiresIn` = config TTL,
    `ResponseContentDisposition` attachment vs inline + RFC 5987 filename;
    local → `kind: 'file'` + stat ok; **traversal key
    (`../../etc/passwd`) rejected**; missing file → `document_file_missing`
  - remove: remote DeleteObject; local unlink + ENOENT tolerated
  - probe: remote ListBuckets; local `fs.access` W_OK
  - span wrapper: network ops call `TracingService.begin('minio', …)` +
    `end`; local ops do not
- **`health.repository.spec.ts`** + **`test/app.e2e-spec.ts`** — provider
  overrides updated to `StorageService`.
- **documents specs** — `documents.storage.ts` (key scheme, SVG disposition)
  tested against a mocked `StorageService`; download-route contract (JSON
  shape for all three drivers) covered in the controller spec.

Verification: backend `npm run typecheck`, `npm run lint`, `npm test`.

---

## §11 Delivery order

1. Install `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; add env
   keys to `.env.example`; gitignore `uploads/`
2. `module/storage/` — constants → config → service → module (+ specs)
3. Migrate health (module / repository / specs) + e2e
4. Migrate tracing (remove `instrumentMinio`, add `send()` wrapper)
5. Uninstall `minio` (grep first: zero imports expected)
6. Update `documents-plan.md` cross-refs (§2/§3/§4/§5/§6/§7)
7. Verify: backend `typecheck` / `lint` / `test`

**No commits, no pushes.**

---

## §12 Out of scope (noted, not built)

- Multipart upload options, retry/transfer-acceleration, SSE-KMS, STS
  sessions
- Presigned **upload** URLs (uploads stream through Nest today)
- Bucket lifecycle/TTL policies, versioning
- Direct-to-S3 browser uploads (would bypass Nest for uploads too)
- `express.static('/uploads')` — deliberately never; only the guarded
  content route serves local files
- Range/HEAD support on the local content route (allowlist has no video;
  single 200 stream is enough)
- Atomic writes (temp file + rename), disk-space monitoring, quota per
  project for the `local` driver
- multer `diskStorage` direct-to-`/uploads` intake (rejected — §5 design
  note)
- Health-check key rename (`checks.minio` → `checks.storage`) — kept
  stable deliberately
