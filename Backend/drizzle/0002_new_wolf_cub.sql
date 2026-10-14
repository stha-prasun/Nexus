-- users.id: serial → uuid (Postgres 17 gen_random_uuid()).
-- int→uuid has no implicit/assignment cast, so the column must be rebuilt.
-- These are dev-only test accounts; the table is wiped first.
DELETE FROM "users";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid();
