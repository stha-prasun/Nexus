import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';

/**
 * One row per uploaded project document — **immutable** (no `updated_at`,
 * no update endpoint; plan §2). The storage object lives in MinIO/S3/`/uploads`
 * under a random `object_key` (`projects/<projectId>/<uuidv4>.<ext>`); the
 * original client filename is kept only here, sanitized, for display and
 * Content-Disposition — it never touches the storage path.
 *
 * `uploaded_by_user_id` cascades like `project_members.user_id` (users are
 * not hard-deleted in this app); `project_id` cascades with the project so
 * removing a project removes its documents and their storage objects are
 * cleaned by the service (storage removal runs before the row delete).
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Sanitized display name (≤ 200 chars, plan §5 step 5). */
    originalName: varchar('original_name', { length: 255 }).notNull(),
    /** Random storage key — unique across the whole bucket/uploads dir. */
    objectKey: varchar('object_key', { length: 512 }).notNull().unique(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    extension: varchar('extension', { length: 10 }).notNull(),
    /** bigint in PG — coerced to number in the repository (≤ 25 MB). */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Project document list (newest first).
    index('documents_project_id_idx').on(table.projectId),
    // "Uploaded by" lookups / cascade audits.
    index('documents_uploaded_by_user_id_idx').on(table.uploadedByUserId),
  ],
);
