import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * System-wide singleton: exactly one organization row may ever exist.
 * The guarantee lives in the DB — `singleton` must be `true` on every row
 * (CHECK), and the UNIQUE index on that constant column then makes a second
 * row impossible, even under concurrent inserts. App code maps the resulting
 * 23505 to 409; it is a fast path, not the enforcement.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: varchar('name', { length: 100 }).notNull(),
    // varchar(63) matches the DTO's 3–63 bounds, so a too-long slug can
    // never reach the database through the API. No unique index while the
    // table can hold at most one row (plan §13).
    slug: varchar('slug', { length: 63 }).notNull(),
    singleton: boolean('singleton').notNull().default(true).unique(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
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
    check('organizations_singleton_check', sql`singleton = true`),
    index('organizations_created_by_user_id_idx').on(table.createdByUserId),
  ],
);
