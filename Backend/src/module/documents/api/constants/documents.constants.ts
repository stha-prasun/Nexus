/**
 * Upload allowlist — the frontend's exact extension list (`lib/documents.ts`
 * `ALLOWED` mirrors this array; no shared package, keep both sides in sync).
 * Append-only in practice: a new type is added here, to `EXTENSION_MIME_MAP`
 * and to the magic-byte sniffer together.
 */
export const ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'md',
  'csv',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'zip',
] as const;

export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

/** 25 MB — enforced by multer's `limits.fileSize` **and** re-checked after. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Longest accepted sanitized original filename (plan §5 step 5). */
export const MAX_FILENAME_LENGTH = 200;

/**
 * Per-extension MIME allowlist — `file.mimetype` must be one of these.
 * Legacy/vendor variants are enumerated deliberately (`image/jpg` from old
 * clients, Office's long vendor strings, Excel's CSV aliases): the check
 * runs against the *client-declared* type, so anything a real browser or
 * Office install can legitimately send belongs here. Content is still
 * sniffed independently (step 4) — a matching MIME proves nothing alone.
 */
export const EXTENSION_MIME_MAP: Record<AllowedExtension, readonly string[]> = {
  pdf: ['application/pdf'],
  doc: [
    'application/msword',
    'application/vnd.ms-office',
    'application/x-msword',
    'application/CDFV2',
  ],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-word.document.macroEnabled.12',
    'application/zip',
    'application/x-zip-compressed',
  ],
  xls: [
    'application/vnd.ms-excel',
    'application/x-msexcel',
    'application/x-excel',
    'application/x-dos_ms_excel',
    'application/CDFV2',
  ],
  xlsx: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroEnabled.12',
    'application/zip',
    'application/x-zip-compressed',
  ],
  ppt: [
    'application/vnd.ms-powerpoint',
    'application/x-mspowerpoint',
    'application/powerpoint',
    'application/x-powerpoint',
    'application/CDFV2',
  ],
  pptx: [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    'application/zip',
    'application/x-zip-compressed',
  ],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain'],
  csv: [
    'text/csv',
    'application/csv',
    'text/comma-separated-values',
    'application/vnd.ms-excel',
  ],
  png: ['image/png'],
  jpg: ['image/jpeg', 'image/jpg'],
  jpeg: ['image/jpeg', 'image/jpg'],
  gif: ['image/gif'],
  svg: ['image/svg+xml', 'image/svg', 'text/xml', 'application/xml'],
  zip: ['application/zip', 'application/x-zip', 'application/x-zip-compressed'],
};

/**
 * Magic-byte signatures for the hand-rolled sniffer (no `file-type` — that
 * package is ESM-only and this codebase is CommonJS, plan §5). Binary
 * families are prefix matches against the raw buffer; `svg`, `txt`, `md`,
 * `csv` are text and checked by the text rules instead.
 */
export const MAGIC_PREFIXES = {
  pdf: Buffer.from('%PDF-', 'ascii'),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  ole2: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: Buffer.from([0xff, 0xd8, 0xff]),
  gif87a: Buffer.from('GIF87a', 'ascii'),
  gif89a: Buffer.from('GIF89a', 'ascii'),
} as const;

/** Extensions whose content must start with one of these OLE2/ZIP prefixes. */
export const ZIP_FAMILY_EXTENSIONS: readonly AllowedExtension[] = [
  'zip',
  'docx',
  'xlsx',
  'pptx',
];

/** Office 97–2003 formats — all OLE2 containers. */
export const OLE2_FAMILY_EXTENSIONS: readonly AllowedExtension[] = [
  'doc',
  'xls',
  'ppt',
];

/** Text formats — no reliable signature; validated as clean UTF-8. */
export const TEXT_EXTENSIONS: readonly AllowedExtension[] = [
  'txt',
  'md',
  'csv',
  'svg',
];

/** 404 — project missing *or* invisible to the actor (no existence leak). */
export const DOCUMENT_PROJECT_NOT_FOUND_STATUS = 'document_project_not_found';
export const DOCUMENT_PROJECT_NOT_FOUND_MESSAGE = 'Project not found.';

/** 404 — document row missing *or* its project is invisible. */
export const DOCUMENT_NOT_FOUND_STATUS = 'document_not_found';
export const DOCUMENT_NOT_FOUND_MESSAGE = 'Document not found.';

/** 400 — zero-byte upload. */
export const FILE_EMPTY_STATUS = 'file_empty';
export const FILE_EMPTY_MESSAGE = 'The uploaded file is empty.';

/** 413 — over `MAX_FILE_BYTES` (multer limit or the post-check). */
export const FILE_TOO_LARGE_STATUS = 'file_too_large';
export const FILE_TOO_LARGE_MESSAGE = 'The file exceeds the 25 MB limit.';

/** 415 — extension not in `ALLOWED_EXTENSIONS`. */
export const FILE_EXTENSION_NOT_ALLOWED_STATUS = 'file_extension_not_allowed';
export const FILE_EXTENSION_NOT_ALLOWED_MESSAGE =
  'That file type is not allowed.';

/** 415 — client MIME not in `EXTENSION_MIME_MAP[ext]`. */
export const FILE_MIME_NOT_ALLOWED_STATUS = 'file_mime_not_allowed';
export const FILE_MIME_NOT_ALLOWED_MESSAGE =
  'The file content type does not match its extension.';

/** 415 — magic-byte sniff contradicts the extension (renamed binary). */
export const FILE_CONTENT_MISMATCH_STATUS = 'file_content_mismatch';
export const FILE_CONTENT_MISMATCH_MESSAGE =
  'The file content does not match its extension.';

/** 400 — multipart body carried no `file` field (or more than one). */
export const FILE_REQUIRED_STATUS = 'file_required';
export const FILE_REQUIRED_MESSAGE = 'Attach exactly one file to upload.';
