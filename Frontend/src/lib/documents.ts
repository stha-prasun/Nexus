import type { ProjectDocument } from '@/lib/api';

/** Project documents domain — shapes, upload rules and display formatters. */

export interface ProjectDoc {
  id: string;
  name: string;
  /** Display name of the uploader (server-provided, not a roster lookup). */
  byName: string;
  /** Bytes — formatted for display via fmtSize. */
  size: number;
  /** ISO timestamp of the upload. */
  at: string;
}

/** An in-flight upload row — progress bar lives in the list until it lands. */
export interface UploadingDoc {
  id: string;
  name: string;
  size: number;
  /** 0–100. */
  progress: number;
}

// Keep in sync with Backend documents.constants.ts (ALLOWED_EXTENSIONS,
// MAX_FILE_BYTES) — no shared package between the two sides.
export const MAX_MB = 25;

export const ALLOWED = [
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

/** Extension → badge colour on the file-type square. */
export const TYPE_COLORS: Record<string, string> = {
  pdf: '#E5484D',
  doc: '#1F2FE0',
  docx: '#1F2FE0',
  txt: '#1F2FE0',
  md: '#1F2FE0',
  xls: '#2FB67C',
  xlsx: '#2FB67C',
  csv: '#2FB67C',
  ppt: '#F59E0B',
  pptx: '#F59E0B',
  png: '#0EA5A5',
  jpg: '#0EA5A5',
  jpeg: '#0EA5A5',
  gif: '#0EA5A5',
  svg: '#0EA5A5',
  zip: '#14183A',
};

export const extOf = (name: string): string =>
  name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';

export const fmtSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

/** API row → page row (ISO dates and the uploader name flatten). */
export const toProjectDoc = (dto: ProjectDocument): ProjectDoc => ({
  id: dto.id,
  name: dto.name,
  byName: dto.uploadedBy.name,
  size: dto.size,
  at: dto.createdAt,
});
