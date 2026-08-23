ALTER TABLE "companies" ADD COLUMN "certifications" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "service_areas" text[] DEFAULT '{}' NOT NULL;