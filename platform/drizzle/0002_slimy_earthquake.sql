CREATE TYPE "public"."offer_status" AS ENUM('submitted', 'withdrawn', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."rate_model" AS ENUM('hourly', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."rfq_status" AS ENUM('new', 'qualified', 'dispatched', 'offers_in', 'accepted', 'lost', 'expired');--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thread_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"attachment_object_key" text,
	"attachment_file_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"contract_value_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"success_fee_pct" numeric(5, 2) NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_rfq_id_unique" UNIQUE("rfq_id"),
	CONSTRAINT "deals_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "offer_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"worker_name" text NOT NULL,
	"trade_role" text,
	"cert_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"rate_model" "rate_model" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"earliest_start" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"note" text,
	"status" "offer_status" DEFAULT 'submitted' NOT NULL,
	"verification_snapshot" jsonb NOT NULL,
	"submitted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfq_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"object_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfq_attachments_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "rfq_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"dispatched_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"site_address" text,
	"site_city" text,
	"site_country" text DEFAULT 'SE' NOT NULL,
	"trade_id" uuid,
	"headcount_needed" integer,
	"start_date" timestamp with time zone,
	"duration_weeks" integer,
	"working_language" text,
	"budget_amount_minor" bigint,
	"budget_currency" text,
	"status" "rfq_status" DEFAULT 'new' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"qualified_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_team_members" ADD CONSTRAINT "offer_team_members_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_attachments" ADD CONSTRAINT "rfq_attachments_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_dispatches" ADD CONSTRAINT "rfq_dispatches_rfq_id_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_dispatches" ADD CONSTRAINT "rfq_dispatches_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_qualified_by_users_id_fk" FOREIGN KEY ("qualified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;