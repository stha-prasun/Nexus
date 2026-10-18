import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { MEMBER_STATUSES } from '../../members/api/constants/members.constants';
import { organizations } from './organizations';
import { roleEnum, users } from './users';

/**
 * Membership lifecycle as a native Postgres enum. Append-only, same rule as
 * `roleEnum` — new states are added to the tail, never reordered.
 */
export const memberStatusEnum = pgEnum('member_status', [...MEMBER_STATUSES]);

/**
 * One row per invitation / membership in the singleton org.
 *
 * The row is keyed by the **invited email** (`email`, always set) — an
 * invitation can target an address whose account does not exist yet (the
 * signup page locks the email and registers the account later). `userId` is
 * therefore nullable: set at invite time when the account already exists,
 * set at accept time when it was created after the invite. Once ACTIVE,
 * `userId` is the row's identity (unique per org).
 *
 * Role lives in exactly one column per state: `invitedRole` while the row is
 * `INVITED` (the inviter's choice, applied at accept), `users.role` once it
 * is `ACTIVE`. The CHECK constraint below makes a half-migrated row
 * impossible — after accept the mirror column is null, so it has nothing to
 * drift from. `invitedRole` shares the existing `role` PG enum (same domain
 * as `users.role`), so both columns are interchangeable at accept time.
 */
export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // NULL while INVITED and the account does not exist yet; set at accept
    // (or at invite, when the account already exists). FK cascade: deleting
    // a user removes their membership rows.
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // The invite identity — normalized (lowercase) email. Unique per org so
    // double-invites collapse to 23505 whether or not an account exists.
    email: varchar('email', { length: 255 }).notNull(),
    status: memberStatusEnum('status').notNull().default('INVITED'),
    // Nullable: set only while INVITED; nulled in the accept transaction.
    invitedRole: roleEnum('invited_role'),
    // Set null (not cascade) so an invite survives its inviter's removal.
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    invitedAt: timestamp('invited_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Double-invite race (same email) collapses to 23505 → 409/merge path.
    unique('organization_members_org_email_unique').on(
      table.organizationId,
      table.email,
    ),
    // Double-accept race (same account) collapses to 23505 → 409.
    // NULLs are distinct in PG unique indexes, so pending accountless
    // invites are unaffected.
    unique('organization_members_org_user_unique').on(
      table.organizationId,
      table.userId,
    ),
    // Status/role invariant enforced by the database, not by app discipline:
    // INVITED ⇒ role present; ACTIVE ⇒ no mirrored role AND a linked account
    // (you can only become ACTIVE by accepting while signed in).
    check(
      'organization_members_status_role_check',
      sql`(status = 'INVITED' AND invited_role IS NOT NULL)
          OR (status = 'ACTIVE' AND invited_role IS NULL AND user_id IS NOT NULL)`,
    ),
    index('organization_members_user_id_idx').on(table.userId),
    index('organization_members_status_idx').on(table.status),
  ],
);
