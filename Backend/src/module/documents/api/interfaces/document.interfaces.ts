import type { AllowedExtension } from '../constants/documents.constants';

/**
 * Raw `documents` row as Postgres returns it (bigint comes back as a
 * string through the `pg` driver — the repository coerces before mapping).
 */
export interface DocumentRow {
  id: string;
  projectId: string;
  uploadedByUserId: string;
  originalName: string;
  objectKey: string;
  mimeType: string;
  extension: AllowedExtension;
  sizeBytes: string | number;
  createdAt: Date;
  uploaderName: string | null;
}

/**
 * Project scoping context — mirrors `tasks.repository.ts`'s `ProjectScope`
 * (same fields, same semantics): the visibility matrix runs against these
 * two membership flags on every request.
 */
export interface ProjectScope {
  id: string;
  name: string;
  /** Actor is a row in `project_members`. */
  isMember: boolean;
  /** Actor's `project_members.is_lead` flag on this project. */
  isLead: boolean;
}
