import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  ALLOWED_EXTENSIONS,
  type AllowedExtension,
  EXTENSION_MIME_MAP,
  FILE_CONTENT_MISMATCH_MESSAGE,
  FILE_CONTENT_MISMATCH_STATUS,
  FILE_EMPTY_MESSAGE,
  FILE_EMPTY_STATUS,
  FILE_EXTENSION_NOT_ALLOWED_MESSAGE,
  FILE_EXTENSION_NOT_ALLOWED_STATUS,
  FILE_MIME_NOT_ALLOWED_MESSAGE,
  FILE_MIME_NOT_ALLOWED_STATUS,
  FILE_TOO_LARGE_MESSAGE,
  FILE_TOO_LARGE_STATUS,
  MAGIC_PREFIXES,
  MAX_FILE_BYTES,
  MAX_FILENAME_LENGTH,
  OLE2_FAMILY_EXTENSIONS,
  TEXT_EXTENSIONS,
  ZIP_FAMILY_EXTENSIONS,
} from '../constants/documents.constants';
import type { ValidatedFile } from '../factories/document.factory';

/** The multer-produced file as the service sees it (memoryStorage). */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Result of the pure validation pipeline — everything the factory needs. */
export type { ValidatedFile };

// ---------------------------------------------------------------- extension

/** Lowercased extension without the dot, or `''` when the name has none. */
export const extensionOf = (filename: string): string => {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
};

export const isAllowedExtension = (ext: string): ext is AllowedExtension =>
  (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);

// ------------------------------------------------------------------ size

/** Presence + size: zero-byte → 400, over 25 MB → 413 (post-check, plan §5). */
export const assertSize = (size: number): void => {
  if (!Number.isFinite(size) || size <= 0) {
    throw new BadRequestException({
      status: FILE_EMPTY_STATUS,
      message: FILE_EMPTY_MESSAGE,
    });
  }
  if (size > MAX_FILE_BYTES) {
    throw new PayloadTooLargeException({
      status: FILE_TOO_LARGE_STATUS,
      message: FILE_TOO_LARGE_MESSAGE,
    });
  }
};

// -------------------------------------------------------------- extension

/** Must be one of the frontend's exact 16 extensions — else 415. */
export const assertExtension = (ext: string): AllowedExtension => {
  if (!isAllowedExtension(ext)) {
    throw new UnsupportedMediaTypeException({
      status: FILE_EXTENSION_NOT_ALLOWED_STATUS,
      message: FILE_EXTENSION_NOT_ALLOWED_MESSAGE,
    });
  }
  return ext;
};

// ------------------------------------------------------------------- mime

/** Client-declared MIME must be in the per-extension allowlist — else 415. */
export const assertMimeType = (
  ext: AllowedExtension,
  mimetype: string,
): void => {
  const allowed = EXTENSION_MIME_MAP[ext];
  if (!allowed.includes(mimetype.toLowerCase())) {
    throw new UnsupportedMediaTypeException({
      status: FILE_MIME_NOT_ALLOWED_STATUS,
      message: FILE_MIME_NOT_ALLOWED_MESSAGE,
    });
  }
};

// ------------------------------------------------------------- magic bytes

const startsWith = (buffer: Buffer, prefix: Buffer): boolean =>
  buffer.length >= prefix.length &&
  buffer.subarray(0, prefix.length).equals(prefix);

/** Strip a UTF-8 BOM and leading whitespace — SVG text checks skip both. */
const textHead = (buffer: Buffer): string => {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.trimStart().toLowerCase();
};

/**
 * Content sniffing — proves the bytes match the claimed extension family.
 * Kills the renamed-binary attack (`MZ` header wearing a `.pdf` name): the
 * client MIME and extension can be faked together, the header cannot.
 * Text formats (txt/md/csv/svg) have no reliable signature and are checked
 * as clean UTF-8 instead.
 */
export const matchesContent = (
  ext: AllowedExtension,
  buffer: Buffer,
): boolean => {
  if (ext === 'pdf') return startsWith(buffer, MAGIC_PREFIXES.pdf);
  if (ZIP_FAMILY_EXTENSIONS.includes(ext))
    return startsWith(buffer, MAGIC_PREFIXES.zip);
  if (OLE2_FAMILY_EXTENSIONS.includes(ext))
    return startsWith(buffer, MAGIC_PREFIXES.ole2);
  if (ext === 'png') return startsWith(buffer, MAGIC_PREFIXES.png);
  if (ext === 'jpg' || ext === 'jpeg')
    return startsWith(buffer, MAGIC_PREFIXES.jpg);
  if (ext === 'gif')
    return (
      startsWith(buffer, MAGIC_PREFIXES.gif87a) ||
      startsWith(buffer, MAGIC_PREFIXES.gif89a)
    );
  // Text family: valid UTF-8, no NUL bytes, and for SVG a recognizable
  // root — `<?xml`, `<svg` or `<!DOCTYPE svg` after BOM/whitespace.
  if (!isCleanUtf8(buffer)) return false;
  if (ext === 'svg') return looksLikeSvg(buffer);
  return true;
};

/** NUL bytes and invalid UTF-8 sequences both disqualify a text file. */
const isCleanUtf8 = (buffer: Buffer): boolean => {
  if (buffer.includes(0x00)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
};

const looksLikeSvg = (buffer: Buffer): boolean => {
  const head = textHead(buffer);
  return (
    head.startsWith('<?xml') ||
    head.startsWith('<svg') ||
    head.startsWith('<!doctype svg')
  );
};

export const assertContent = (ext: AllowedExtension, buffer: Buffer): void => {
  if (!matchesContent(ext, buffer)) {
    throw new UnsupportedMediaTypeException({
      status: FILE_CONTENT_MISMATCH_STATUS,
      message: FILE_CONTENT_MISMATCH_MESSAGE,
    });
  }
};

// --------------------------------------------------------------- filename

/**
 * Sanitize the client name for display (plan §5 step 5): strip path
 * components, drop control chars, collapse whitespace, forbid a leading
 * dot (no hidden files), cap at 200 chars, never empty. The stored object
 * key is a random UUID regardless — this name only reaches the DB and the
 * Content-Disposition header.
 */
export const sanitizeFilename = (
  rawName: string,
  ext: AllowedExtension,
): string => {
  const base = (rawName.split(/[\\/]/).pop() ?? '')
    // Control chars (incl. NUL) and other C0/C1 offenders.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping hostile input is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const noLeadingDot = base.replace(/^\.+/, '');
  const capped = noLeadingDot.slice(0, MAX_FILENAME_LENGTH).trim();
  if (capped.length > 0) return capped;
  return `document.${ext}`;
};

// ------------------------------------------------------------ the pipeline

/**
 * The full §5 pipeline on one multer file — pure, fully unit tested, called
 * by the service after the interceptor's own `limits.fileSize` (defense in
 * depth: never trust the limit alone held). Order: size → extension → MIME →
 * magic bytes → filename.
 */
export const validateUpload = (file: UploadedFile): ValidatedFile => {
  assertSize(file.size);
  const ext = assertExtension(extensionOf(file.originalname));
  assertMimeType(ext, file.mimetype);
  assertContent(ext, file.buffer);
  return {
    originalName: sanitizeFilename(file.originalname, ext),
    // Serve what the extension claims; the sniffer already proved the bytes.
    mimeType: EXTENSION_MIME_MAP[ext][0] as string,
    extension: ext,
    sizeBytes: file.size,
  };
};

/** Which extension family a magic check belongs to — used by specs/docs. */
export const TEXT_FAMILY_EXTENSIONS = TEXT_EXTENSIONS;
