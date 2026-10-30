import type { ProjectMember } from '@/lib/api';

/** Project documents domain — shapes, upload rules and demo seed (project-documents.html). */

export interface ProjectDoc {
  id: string;
  name: string;
  /** ProjectMember.userId of the uploader. */
  byUserId: string;
  /** Bytes — formatted for display via fmtSize. */
  size: number;
  /** ISO timestamp of the upload. */
  at: string;
  /** Object URL for locally uploaded files; null for the demo seed rows. */
  url: string | null;
}

/** An in-flight upload row — progress bar lives in the list until it lands. */
export interface UploadingDoc {
  id: string;
  name: string;
  size: number;
  /** 0–100. */
  progress: number;
}

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

/** ISO timestamp N days from today (negative = in the past). */
export const daysAgo = (offset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString();
};

/** [name, demo uploader email, size in bytes, day offset]. */
type SeedRow = [string, string, number, number];

/**
 * Demo files from the design (project 1). Seeded for every project — the same
 * way the board seeds its 12 demo tasks — so the tabs' Documents badge reads
 * "4" consistently across all three pages.
 */
const SEED: SeedRow[] = [
  ['Project brief.pdf', 'jonas@acme.com', 1_258_291, -12],
  ['Sitemap v3.xlsx', 'priya@acme.com', 348_160, -6],
  ['Brand guidelines.pdf', 'lena@acme.com', 5_033_164, -4],
  ['Homepage wireframes.png', 'lena@acme.com', 2_202_009, -1],
];

/** Seed rows shown on other pages' tab badges while this page isn't open. */
export const SEED_DOC_COUNT = SEED.length;

/**
 * Seed emails map onto the current roster — a real project falls back to a
 * stable round-robin so every member appears as an uploader.
 */
const resolveUploader = (
  email: string,
  members: ProjectMember[],
  index: number,
): string => {
  const hit = members.find((member) => member.email === email);
  if (hit) return hit.userId;
  return members[index % members.length]?.userId ?? '';
};

export function seedDocs(members: ProjectMember[]): ProjectDoc[] {
  return SEED.map(([name, email, size, offset], index) => ({
    id: `seed${index}`,
    name,
    byUserId: email ? resolveUploader(email, members, index) : '',
    size,
    at: daysAgo(offset),
    url: null,
  }));
}
