ALTER TABLE "capacity_listings" ADD COLUMN "indicative_rate_min_minor" integer;--> statement-breakpoint
ALTER TABLE "capacity_listings" ADD COLUMN "indicative_rate_max_minor" integer;--> statement-breakpoint
ALTER TABLE "capacity_listings" ADD COLUMN "indicative_rate_currency" text;--> statement-breakpoint
ALTER TABLE "capacity_listings" ADD COLUMN "indicative_rate_unit" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "buyer_org_number" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "buyer_company_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "buyer_country" text;