# Documents Upload — Implementation Plan

> Project documents for projects: **Admin, PM and project Lead Dev may upload;
> everyone who can see the project may view/download.** Files live in MinIO,
> any S3, or the server's own disk (`/uploads`) per `STORAGE_DRIVER` — built by
> `storage-plan.md`; metadata in Postgres. Validation covers MIME type, file
> size, extension and filename (plus content sniffing). **No commits, no
> pushes** during this work.

---

## §1 Decisions (confirmed)

| Concern | Decision |
|---|---|
| View/download | `canSee`: **Admin + HR see all projects, members see their own** (mirrors `TasksPolicy.canSee`); non-member → **404** (no existence leak) |
| Upload | `canManage`: **Admin any project; PM or project Lead only when a member** (exactly `TasksPolicy.canManage`); visible-but-forbidden → **403 `role_forbidden`** |
| Delete | Same matrix as upload |
| Download | **Presigned GET** (minio/s3) or the guarded **local content route** (`local`); 5-min TTL applies to presigned only; issued only after authz |
| Storage | Three drivers (`minio\|s3\|local`) via `STORAGE_DRIVER` env — built by `storage-plan.md` |
| File rules | Frontend extension list, **25 MB**, extension→MIME allowlist, **magic-byte sniffing**, sanitized filename |
| SVG | Allowed, but **always served as `attachment`** (no inline script execution) |

Permission matrix (single source of truth: `documents.policy.ts`):

| Actor | View / download | Upload | Delete |
|---|---|---|---|
| Admin (any project) | ✅ | ✅ | ✅ |
| HR (any project) | ✅ | ❌ | ❌ |
| PM, member of project | ✅ | ✅ | ✅ |
| PM, not a member | 404 | 404 | 404 |
| Lead Dev (`is_lead`), member | ✅ | ✅ | ✅ |
| Dev, member (not lead) | ✅ | ❌ | ❌ |
| Dev, not a member | 404 | 404 | 404 |

Failure shapes (same deliberate split as tasks):

- Invisible project (non-member, non-Admin/HR) → **404** — missing and
  forbidden are indistinguishable, no existence leak.
- Visible but not allowed (e.g. plain Dev trying to upload) →
  **403** `{ status: 'role_forbidden', message }`.

---

## §2 Data model

New table `Backend/src/module/database/schema/documents.ts`, exported from
`schema/index.ts`, then `npm run db:generate`.

```
documents
  id                  uuid PK default gen_random_uuid()
  project_id          uuid NOT NULL → projects.id ON DELETE CASCADE
  uploaded_by_user_id uuid NOT NULL → users.id ON DELETE CASCADE   (matches project_members)
  original_name       varchar(255) NOT NULL   — sanitized display name
  object_key          varchar(512) NOT NULL UNIQUE
  mime_type           varchar(100) NOT NULL
  extension           varchar(10) NOT NULL
  size_bytes          bigint NOT NULL
  created_at          timestamptz NOT NULL DEFAULT now()
  indexes: (project_id), (uploaded_by_user_id)
```

- Immutable rows — no `updated_at`, no update endpoint.
- Delete removes the storage object (driver-agnostic — MinIO/S3 object or
  the `/uploads` file) **and** the row (hard delete).
- `uploaded_by_user_id` cascades like `project_members.user_id` (users are
  not hard-deleted in this app).

**Storage layout** (see `storage-plan.md`)

- **Remote (minio/s3):** bucket `env('STORAGE_BUCKET', 'nexus-documents')`
  (private, created on module init if missing — ignore
  `BucketAlreadyOwnedByYou`).
- **Local:** files land at `<STORAGE_LOCAL_DIR>/<object-key>` (default
  `Backend/uploads`); `uploads/` is gitignored and **never** served
  statically — only via the guarded content route (§4).
- Object key: `projects/<projectId>/<uuidv4>.<ext>` — the original filename
  **never** touches the storage path (identical scheme for all three
  drivers).
- Original name kept only in `documents.original_name` (display +
  Content-Disposition).

---

## §3 Module structure (matches existing convention)

Your folders inside `api/` (6 existing + 3 added for this feature):

```
Backend/src/module/documents/
├── api/
│   ├── constants/                      ← documents.constants.ts:
│   │                                        ALLOWED_EXTENSIONS, EXTENSION_MIME_MAP,
│   │                                        MAX_FILE_BYTES (25 MB), MAGIC signatures,
│   │                                        error codes (bucket name + presign TTL
│   │                                        live in storage/config — storage-plan.md)
│   ├── dto/                            ← documents-responses.dto.ts:
│   │                                        DocumentResponseDto, ListDocumentsResponseDto,
│   │                                        DownloadUrlResponseDto + toX mappers
│   ├── entities/                       ← document.entity.ts (real domain class)
│   ├── factories/                      ← document.factory.ts
│   ├── interfaces/                     ← row/context types (e.g. DocumentRow, ProjectScope)
│   ├── repositories/                   ← documents.repository.ts (+spec)
│   ├── policies/                       ← documents.policy.ts: canSee / canManage
│   │                                        (mirror of tasks.policy)
│   ├── storage/                        ← documents.storage.ts: object-key scheme
│   │                                        + SVG/disposition policy; delegates I/O
│   │                                        to StorageService (+spec)
│   ├── validation/                     ← file.validator.ts: pure functions — ext, mime,
│   │                                        magic bytes, filename (+spec)
│   ├── documents.module.ts             (+ JSDoc; deps: DatabaseModule, AuthModule, StorageModule)
│   ├── documents.controller.ts         (+spec)
│   └── documents.service.ts            (+spec)
└── docs/documents-plan.md              ← this plan
```

**Scaffold cleanup** (untracked Nest CLI boilerplate):

- Delete empty `dto/create-document.dto.ts` — multipart upload has no body DTO.
- Delete `dto/update-document.dto.ts` — documents are immutable.
- Keep `interfaces/` (your folder) — holds row/context types (`DocumentRow`,
  `ProjectScope`) as they earn a place; empty until then.
- Replace empty `entities/document.entity.ts` stub with a real domain class.

**Storage client:** the leaf is `Backend/src/module/storage/` (aws-sdk,
three drivers, health/tracing migration) — built entirely by
`storage-plan.md`. Documents only ever sees `StorageService`; the old idea of
moving `MINIO_CLIENT` out of `HealthModule` into a `minio` module is
superseded by that plan.

**Fix:** `app.module.ts` import → `'./module/documents/api/documents.module'`
(currently broken: `'./documents/documents.module'` — typecheck fails).

Dependency direction (documented in module JSDoc, like `TasksModule`):
`DocumentsModule → DatabaseModule, AuthModule, StorageModule` — nothing
imports DocumentsModule except `AppModule`.

---

## §4 Endpoints (flat paths, tasks-style)

All routes: `@UseGuards(SessionAuthGuard, ActiveMemberGuard)` — **no
`@Roles`** (the matrix is role + membership sensitive, same reasoning as
tasks). `req.user` is the `SessionUser` session snapshot.

| Route | Behavior |
|---|---|
| `GET /projects/:projectId/documents` | `{ documents: [...] }`, newest-first, uploader resolved via join |
| `POST /projects/:projectId/documents` | multipart field `file`, exactly one file; **201** `{ document }` |
| `GET /projects/:projectId/documents/:documentId/download` | **200 JSON** `{ url, expiresInSeconds }` — minio/s3: absolute presigned URL + `300`; `local`: relative `/api/v1/.../download/content` path + `0` |
| `GET /projects/:projectId/documents/:documentId/download/content` | Streams the file — **`local` driver only** (else 404); fully guarded like every route; missing file on disk → 404 `document_file_missing` |
| `DELETE /projects/:projectId/documents/:documentId` | **200** `{ message, deleted: 1 }`; missing → 404 `document_not_found` |

Service flow per request:

1. `requireVisible(projectId, actor)` — repository scope read (joins
   `project_members` → `isMember`, `isLead`); `policy.canSee(role, isMember)`
   false → **404**.
2. Mutations (upload/delete) then `policy.canManage(actor)` false →
   **403** `role_forbidden`.
3. Download resolves a URL via `StorageService.resolveDownload` only after
   step 1; the `download/content` route (local driver) re-runs the guards +
   `requireVisible` on its own request.

Response DTO fields (via `documents-responses.dto.ts` mappers, entities never
serialized raw): `id`, `name` (original_name), `size`, `extension`,
`uploadedBy: { id, name }`, `createdAt`. Download adds `url`,
`expiresInSeconds`.

Swagger: `@ApiTags('Documents')`, `@ApiOperation` per route (summarize the
permission rule in the summary, as the tasks controller does).

---

## §5 File validation pipeline (MIME, size, extension, filename)

Executed in `validation/file.validator.ts` — pure functions, fully unit
tested — called by the service after multer:

1. **Presence / size**
   - Multer `FileInterceptor('file', { storage: memoryStorage, limits: {
     fileSize: 25 MB, files: 1 } })`.
   - `MulterError: LIMIT_FILE_SIZE` caught in the controller →
     **413** `{ status: 'file_too_large' }`.
   - Zero-byte file → **400** `{ status: 'file_empty' }`.
   - Post-check `file.size > 0` and `<= MAX_FILE_BYTES` (defense in depth —
     never trust that the interceptor limit alone held).
2. **Extension**
   - Lowercase the extension; must ∈ `ALLOWED_EXTENSIONS` — the frontend's
     exact list: `pdf, doc, docx, xls, xlsx, ppt, pptx, txt, md, csv, png,
     jpg, jpeg, gif, svg, zip`.
   - Else → **415** `{ status: 'file_extension_not_allowed' }`.
3. **MIME type**
   - `file.mimetype` must ∈ per-extension allowlist `EXTENSION_MIME_MAP`
     (include legacy variants, e.g. `image/jpg` alongside `image/jpeg`;
     office types have long vendor MIME strings — enumerate them).
   - Else → **415** `{ status: 'file_mime_not_allowed' }`.
4. **Magic bytes (content sniffing)**
   - Hand-rolled sniffer (~80 lines, **no new dependency** — `file-type` is
     ESM-only and this codebase is CommonJS):
     | Family | Signature |
     |---|---|
     | pdf | `%PDF-` |
     | zip / docx / xlsx / pptx | `PK\x03\x04` |
     | doc / xls / ppt (OLE2) | `\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1` |
     | png | `\x89PNG\r\n\x1a\n` |
     | jpg / jpeg | `\xFF\xD8\xFF` |
     | gif | `GIF87a` / `GIF89a` |
     | svg | text starting with `<?xml`, `<svg` or `<!DOCTYPE svg` (after BOM/whitespace) |
     | txt / md / csv | valid UTF-8, no NUL bytes (no reliable signature) |
   - Mismatch → **415** `{ status: 'file_content_mismatch' }` — kills the
     renamed-`.exe`-as-`.pdf` attack.
5. **Filename**
   - Sanitize the client name: strip path components (`/`, `\`), remove
     control chars, collapse whitespace, forbid leading dots (no hidden
     files), cap at 200 chars, never empty (fallback `document.<ext>`).
   - Stored as `original_name`; **object key is a random UUID** regardless.

**SVG:** stored normally; downloads for `.svg` always carry
`Content-Disposition: attachment` — applied as the presigned
`ResponseContentDisposition` param (minio/s3) or the response header
(`local`, set by the controller from the same policy). Other types:
`inline; filename="<sanitized original>"` (filename RFC 5987-encoded).

**Streaming note:** multer `memoryStorage` buffers ≤ 25 MB in RAM per
concurrent upload — the intake is shared by **all three drivers**
(`storage-plan.md` §5); direct streaming to storage flagged as a future
optimization (not in scope).

---

## §6 Frontend rewiring

- **`Frontend/src/lib/api.ts`**
  - `listProjectDocuments(projectId)` → `GET /projects/:id/documents`
  - `uploadProjectDocument(projectId, file, onProgress)` → `POST` multipart
    via **XHR** (fetch has no upload progress; page renders progress bars)
  - `getDocumentDownloadUrl(projectId, docId)` → `{ url, expiresInSeconds }`
  - `deleteProjectDocument(projectId, docId)` → `DELETE`
- **`Frontend/src/pages/ProjectDocumentsPage.tsx`**
  - Drop `seedDocs()` — real fetch on mount (keep existing skeleton / 404 /
    401 handling).
  - Real upload with progress; server validation errors surfaced from the
    `{ status, message }` body (413/415/400).
  - Optimistic delete with rollback + toast on failure (existing TODO:
    `DELETE /projects/:id/documents/:docId`).
  - Download opens `url` as-is when absolute (presigned), else resolves the
    relative content path against the API base:
    `new URL(url, API_BASE)` — one code path for all three drivers.
  - `canUpload = Admin || (isMember && (PM || isLead))` — replaces the
    current looser rule (`Admin || isMember`).
- **`Frontend/src/lib/documents.ts`**
  - Keep `ALLOWED`, `MAX_MB`, `TYPE_COLORS`, formatters — they mirror the
    backend constants (no shared package; keep in sync by comment on both
    sides).
  - Remove `seedDocs()` and `SEED_DOC_COUNT` (demo rows no longer render).
- **`Frontend/src/components/dashboard/ProjectTabs.tsx`**
  - `docCount` prop fed from the real list length (page already passes
    `docs.length`).

---

## §7 Security checklist

- Remote objects: private bucket, no public/policy-based access — reachable
  only via short-TTL presigned URLs issued after authz. Local files:
  `/uploads` is **never** served statically — only via the guarded
  `download/content` route, with a path-traversal check under the uploads
  dir (`storage-plan.md` §5).
- 404-for-invisible (no existence leak); 403 `role_forbidden` for
  visible-but-forbidden.
- Server never trusts client MIME/extension — content is sniffed.
- Random object keys; sanitized original name only in DB + Content-Disposition
  (path traversal, NUL bytes, control chars, hidden files all rejected).
- Size enforced at multer **and** re-checked after (defense in depth).
- SVG always `attachment` — no inline script execution.
- Global `ThrottlerGuard` already covers the upload route (optional stricter
  per-route limit noted as a follow-up, not in scope).
- Error bodies follow the repo convention `{ status: 'snake_case_code',
  message }`.
- No secrets in URLs beyond the signed GET itself; presign TTL =
  `STORAGE_PRESIGN_TTL_SECONDS` (300 s).

---

## §8 Test plan

- **`file.validator.spec.ts`** — every rule: each allowed extension accepted;
  disallowed extension rejected; MIME mismatch rejected; every magic
  signature accept/reject pair; renamed binary (`MZ` header as `.pdf`)
  rejected; path traversal (`../../etc/passwd`), NUL bytes, control chars,
  300-char names, leading-dot names; empty file; txt/md/csv UTF-8 + NUL
  cases.
- **`documents.policy.spec.ts`** — full role × membership matrix table
  (§1) as data-driven cases.
- **`documents.service.spec.ts`** — 404 invisible / 403 forbidden flows;
  upload happy path (storage + repository mocked); delete removes object
  then row; download resolves URL only after `requireVisible` (mock
  `StorageService.resolveDownload`); multer error mapping.
- **`documents.controller.spec.ts`** — guards present on every route
  (`SessionAuthGuard`, `ActiveMemberGuard`); response shapes incl. the
  download JSON contract for all three drivers + `download/content`
  (404 when driver ≠ `local`, stream headers when `local`, 404
  `document_file_missing`); 413 mapping for `LIMIT_FILE_SIZE`.
- **`documents.repository.spec.ts`** — list/scope/find queries (follow the
  existing repo-spec mocking pattern).

Verification commands (both sides, before finishing):

- Backend: `npm run typecheck`, `npm run lint`, `npm test`
- Frontend: `npm run typecheck`, `npm run lint`

---

## §9 Delivery order

1. Save this plan → `docs/documents-plan.md`; fix scaffold + `app.module.ts`
   import path.
2. Constants + policy + entity + factory (+ specs).
3. Schema `documents.ts` + `schema/index.ts` export + `npm run db:generate`.
4. Storage leaf module per **`storage-plan.md` §11** (install aws-sdk →
   `module/storage/` → health + tracing migration → uninstall `minio`) —
   must land before step 6 (documents service/controller depend on
   `StorageService`).
5. File validator (+ spec).
6. Repository → service → controller → response DTOs (+ specs).
7. Frontend: `api.ts` → `ProjectDocumentsPage` rewire → tabs count.
8. Verify: backend `typecheck`/`lint`/`test`, frontend `typecheck`/`lint`.

**No commits, no pushes.**

---

## §10 Out of scope (noted, not built)

- Per-route stricter rate limit on upload (global throttler applies today).
- Virus scanning — interface stub only if requested later.
- Direct streaming of large uploads to storage (memoryStorage is enough at
  current scale; see `storage-plan.md` §12).
- Folders/nested organization inside a project's documents.
- Document versioning / editing (rows are immutable).
- Public/share links outside the app (presigned URLs are short-lived and
  only issued to authorized sessions; local content URLs are session-guarded,
  never presigned).
