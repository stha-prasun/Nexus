import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizationMembers } from './organization-members';
import { projects } from './projects';
import { users } from './users';

/**
 * One row per (project, org member) pair.
 *
 * Why both FKs: `organizationMemberId` makes "only org members can be
 * project members" **structural** — a project-membership row cannot outlive
 * its org-membership row (org removal cascades it away, plan §7.11/§7.18);
 * `userId` keeps the hot queries (my projects, sole-lead scans) single-join.
 * Rows are only ever inserted together with a fresh org-membership read, so
 * the pair cannot drift.
 *
 * The ≥1-lead invariant is a *row-count* invariant — no table-level CHECK
 * can express it. It lives in the services under per-project advisory locks
 * (plan §2): both the project-removal path and the org-removal path
 * (members.repository) re-check the count under the same lock.
 */
export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    organizationMemberId: uuid('organization_member_id')
      .notNull()
      .references(() => organizationMembers.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isLead: boolean('is_lead').notNull().default(false),
    // Set null (not cascade) so the membership survives the adder's removal.
    addedByUserId: uuid('added_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Double-add race (API pre-check lost) collapses to 23505 → 409.
    unique('project_members_project_user_unique').on(
      table.projectId,
      table.userId,
    ),
    unique('project_members_project_org_member_unique').on(
      table.projectId,
      table.organizationMemberId,
    ),
    // userId drives visibility ("my projects") and sole-lead scans.
    index('project_members_user_id_idx').on(table.userId),
    index('project_members_project_id_idx').on(table.projectId),
  ],
);
