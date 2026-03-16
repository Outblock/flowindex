CREATE TABLE "flowindex_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_prefix" text NOT NULL,
	"endpoint_id" text,
	"signing_secret" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "metadata" json DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "flowindex_api_key" ADD CONSTRAINT "flowindex_api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "flowindex_api_key_user_idx" ON "flowindex_api_key" USING btree ("user_id");