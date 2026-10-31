import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { DEFAULT_PROJECT_COLOR } from '../../projects/api/constants/projects.constants';
import { organizations } from './organizations';
import { users } from './users';

/**
 * One row per project inside the singleton organization. `createdByUserId`
 * is display credit only — the creator keeps no rights once removed from
 * `project_members` (plan §1). Duplicate names are allowed on purpose (no
 * uniqueness constraint): projects are disambiguated by id/color, not name.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    // Nullable so pre-description rows stay valid; the DTO bounds it at 500.
    description: varchar('description', { length: 500 }),
    // varchar(7) matches the DTO's `#rrggbb` bound; the CHECK mirrors the
    // DTO's @Matches so a bad hex can never land through any path.
    color: varchar('color', { length: 7 })
      .notNull()
      .default(DEFAULT_PROJECT_COLOR),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /**
     * Monotonic source for `tasks.seq` (plan §8.2): incremented under the
     * per-project advisory lock and never decremented, so deleting the
     * highest task can never reissue its key while external references
     * (notification snapshots, copied links) still point at it. Gaps from
     * deleted tasks are correct by design.
     */
    taskCounter: integer('task_counter').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      // Stamped by Drizzle on every UPDATE through the query builder.
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('projects_color_check', sql`color ~ '^#[0-9A-Fa-f]{6}$'`),
    index('projects_organization_id_idx').on(table.organizationId),
    index('projects_created_by_user_id_idx').on(table.createdByUserId),
  ],
);
