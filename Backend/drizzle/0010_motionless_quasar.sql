CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"extension" varchar(10) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_project_id_idx" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "documents_uploaded_by_user_id_idx" ON "documents" USING btree ("uploaded_by_user_id");