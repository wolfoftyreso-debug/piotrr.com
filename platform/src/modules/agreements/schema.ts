import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "@/modules/companies/schema";
import { users } from "@/modules/identity/schema";

export const agreementState = pgEnum("agreement_state", [
  "draft",
  "proposed",
  "signed",
  "cancelled",
  "superseded",
]);

export const signatureParty = pgEnum("signature_party", ["buyer", "supplier"]);

/**
 * The documented agreement for one accepted offer.
 *
 * `terms` is the structured content; `documentHash` is the SHA-256 of the
 * canonical rendering of exactly those terms. Signatures reference a hash,
 * so editing a term after signing does not quietly change what someone
 * agreed to — it invalidates the signatures instead.
 */
export const agreements = pgTable(
  "agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rfqId: uuid("rfq_id").notNull(),
    offerId: uuid("offer_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    buyerUserId: uuid("buyer_user_id")
      .notNull()
      .references(() => users.id),
    /** The thread that holds the negotiation this agreement came out of. */
    threadId: uuid("thread_id"),

    state: agreementState("state").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    terms: jsonb("terms").notNull(),
    /** Canonical text as rendered from `terms` at the current version. */
    documentText: text("document_text").notNull(),
    documentHash: text("document_hash").notNull(),

    signedAt: timestamp("signed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** Set when a later agreement replaces this one. */
    supersededBy: uuid("superseded_by"),

    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_agreements_company").on(t.companyId),index("agreements_offer_idx").on(t.offerId)],
);

/**
 * One row per party per signed version.
 *
 * `documentHash` records what was actually on screen when the person
 * signed — that, not the row's existence, is what makes the signature
 * provable. The unique constraint allows re-signing a new version while
 * preventing the same party signing the same text twice.
 */
export const agreementSignatures = pgTable(
  "agreement_signatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id, { onDelete: "cascade" }),
    party: signatureParty("party").notNull(),
    /** PII: who signed. */
    signedByUserId: uuid("signed_by_user_id")
      .notNull()
      .references(() => users.id),
    signerName: text("signer_name").notNull(),
    /** The exact text this signature covers. */
    documentHash: text("document_hash").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Hashed, never the address itself (GDPR §4.6). */
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("idx_agreement_signatures_signer").on(t.signedByUserId),
    unique("agreement_signature_once").on(t.agreementId, t.party, t.documentHash),
    index("agreement_signatures_agreement_idx").on(t.agreementId),
  ],
);
