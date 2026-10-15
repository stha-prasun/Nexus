import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ROLES } from '../../auth/api/constants/auth.constants';

/**
 * `users.role` whitelist as a native Postgres enum, derived from the auth
 * module's ROLES — the same constant behind `@IsIn(ROLES)` at the API
 * boundary, so schema and DTO can't drift. The DB rejects anything outside
 * the set even on direct SQL, which makes the repository's `row.role as Role`
 * cast sound by construction. Single column, no join table.
 *
 * Postgres enums can only gain values, never drop or reorder them — the
 * three roles are treated as a stable domain.
 */
export const roleEnum = pgEnum('role', [...ROLES]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  role: roleEnum('role').notNull().default('PM'),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
