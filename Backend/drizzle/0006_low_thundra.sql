CREATE TYPE "public"."member_status" AS ENUM('INVITED', 'ACTIVE');--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"email" varchar(255) NOT NULL,
	"status" "member_status" DEFAULT 'INVITED' NOT NULL,
	"invited_role" "role",
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_org_email_unique" UNIQUE("organization_id","email"),
	CONSTRAINT "organization_members_org_user_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "organization_members_status_role_check" CHECK ((status = 'INVITED' AND invited_role IS NOT NULL)
          OR (status = 'ACTIVE' AND invited_role IS NULL AND user_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_members_user_id_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organization_members_status_idx" ON "organization_members" USING btree ("status");