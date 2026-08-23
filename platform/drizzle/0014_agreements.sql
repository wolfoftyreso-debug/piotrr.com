CREATE TYPE "public"."agreement_state" AS ENUM('draft', 'proposed', 'signed', 'cancelled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."signature_party" AS ENUM('buyer', 'supplier');--> statement-breakpoint
CREATE TABLE "agreement_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agreement_id" uuid NOT NULL,
	"party" "signature_party" NOT NULL,
	"signed_by_user_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"document_hash" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	CONSTRAINT "agreement_signature_once" UNIQUE("agreement_id","party","document_hash")
);
--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"thread_id" uuid,
	"state" "agreement_state" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"terms" jsonb NOT NULL,
	"document_text" text NOT NULL,
	"document_hash" text NOT NULL,
	"signed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"superseded_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreement_signatures_agreement_idx" ON "agreement_signatures" USING btree ("agreement_id");--> statement-breakpoint
CREATE INDEX "agreements_offer_idx" ON "agreements" USING btree ("offer_id");