import {
  bigint,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "@/modules/identity/schema";

/**
 * Offers module (M3). Offer submissions are legally sensitive: each offer
 * stores a verification snapshot FROZEN at submission time (audit
 * requirement, Section 5/M3 — covered by mandatory unit tests).
 */
export const offerStatus = pgEnum("offer_status", [
  "submitted",
  "withdrawn",
  "accepted",
  "rejected",
  "expired",
]);

export const rateModel = pgEnum("rate_model", ["hourly", "fixed"]);

export const offers = pgTable("offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull(),
  companyId: uuid("company_id").notNull(),
  rateModel: rateModel("rate_model").notNull(),
  // Money: amount_minor + currency EUR|SEK (Section 3)
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("EUR"),
  earliestStart: timestamp("earliest_start", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  note: text("note"),
  status: offerStatus("status").notNull().default("submitted"),
  /** Verification state frozen at submission — never recomputed */
  verificationSnapshot: jsonb("verification_snapshot").notNull(),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Named team members on the offer; cert status frozen with the snapshot */
export const offerTeamMembers = pgTable("offer_team_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerId: uuid("offer_id")
    .notNull()
    .references(() => offers.id),
  workerId: uuid("worker_id").notNull(),
  workerName: text("worker_name").notNull(),
  tradeRole: text("trade_role"),
  certStatus: jsonb("cert_status").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index("idx_offer_team_members_offer").on(t.offerId)],
);

/** Recorded by ops on acceptance — invoiced manually, no in-platform payments */
export const deals = pgTable("deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  rfqId: uuid("rfq_id").notNull().unique(),
  offerId: uuid("offer_id").notNull().unique(),
  companyId: uuid("company_id").notNull(),
  buyerUserId: uuid("buyer_user_id").notNull(),
  contractValueMinor: bigint("contract_value_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("EUR"),
  successFeePct: numeric("success_fee_pct", { precision: 5, scale: 2 }).notNull(),
  note: text("note"),
  recordedBy: uuid("recorded_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
