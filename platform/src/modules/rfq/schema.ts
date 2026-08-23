import {
  bigint,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";

/**
 * RFQ module (M3). Lifecycle is ops-driven — concierge matching is a
 * first-class feature, auto-matching is deliberately NOT built (Section 5).
 */
export const rfqStatus = pgEnum("rfq_status", [
  "new",
  "qualified",
  "dispatched",
  "offers_in",
  "accepted",
  "lost",
  "expired",
]);

export const rfqs = pgTable("rfqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerUserId: uuid("buyer_user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  // PII-adjacent: site address for the work package
  siteAddress: text("site_address"),
  siteCity: text("site_city"),
  siteCountry: text("site_country").notNull().default("SE"),
  tradeId: uuid("trade_id"),
  headcountNeeded: integer("headcount_needed"),
  startDate: timestamp("start_date", { withTimezone: true }),
  durationWeeks: integer("duration_weeks"),
  workingLanguage: text("working_language"),
  // Money: amount_minor + currency EUR|SEK, no FX (Section 3)
  budgetAmountMinor: bigint("budget_amount_minor", { mode: "number" }),
  budgetCurrency: text("budget_currency"),
  status: rfqStatus("status").notNull().default("new"),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  qualifiedBy: uuid("qualified_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
},
  (t) => [index("idx_rfqs_buyer").on(t.buyerUserId)],
);

/** Drawings/photos attached by the buyer (object-storage key + metadata) */
export const rfqAttachments = pgTable("rfq_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id")
    .notNull()
    .references(() => rfqs.id),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  objectKey: text("object_key").notNull().unique(),
  uploadedBy: uuid("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index("idx_rfq_attachments_rfq").on(t.rfqId)],
);

/** Ops selects candidate suppliers and dispatches the RFQ to them */
export const rfqDispatches = pgTable("rfq_dispatches", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id")
    .notNull()
    .references(() => rfqs.id),
  companyId: uuid("company_id").notNull(),
  dispatchedBy: uuid("dispatched_by")
    .notNull()
    .references(() => users.id),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index("idx_rfq_dispatches_rfq").on(t.rfqId)],
);
