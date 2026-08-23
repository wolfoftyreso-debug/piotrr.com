CREATE TYPE "public"."claim_status" AS ENUM('claimed', 'unclaimed');--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "claim_status" "claim_status" DEFAULT 'claimed' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "source_name" text;