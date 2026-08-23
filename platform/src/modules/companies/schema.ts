import {
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
 * Catalog provenance: profiles imported from open public sources start as
 * 'unclaimed' and can be taken over by the company via verification.
 */
export const claimStatus = pgEnum("claim_status", ["claimed", "unclaimed"]);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  country: text("country").notNull(), // ISO 3166-1 alpha-2, e.g. "LT"
  registrationNumber: text("registration_number"), // national registry no
  vatNumber: text("vat_number"),
  description: text("description"),
  city: text("city"),
  // PII-adjacent contact data lives on contacts, not here
  website: text("website"),
  yearFounded: integer("year_founded"),
  headcount: integer("headcount"),
  languages: text("languages").array().notNull().default([]),
  ownerUserId: uuid("owner_user_id").references(() => users.id),
  /** Self-reported on the profile; shown separately from VERIFIED facts */
  certifications: text("certifications").array().notNull().default([]),
  /** Stated awards/recognitions (e.g. "Gazele Biznesu 2023") — self-reported
   *  or sourced from public pages; never implies platform verification */
  awards: text("awards").array().notNull().default([]),
  /** Where the company takes on work (regions/countries, free text) */
  serviceAreas: text("service_areas").array().notNull().default([]),
  /** Unclaimed = imported from an open source; claimable via verification */
  claimStatus: claimStatus("claim_status").notNull().default("claimed"),
  category: text("category"),
  /** Original public source for imported profiles (attribution + audit) */
  sourceUrl: text("source_url"),
  sourceName: text("source_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
},
  (t) => [index("idx_companies_owner").on(t.ownerUserId)],
);

/** Permanent slugs; renames append a new row and old slugs redirect */
export const companySlugs = pgTable("company_slugs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  slug: text("slug").notNull().unique(),
  isPrimary: integer("is_primary").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index("idx_company_slugs_company").on(t.companyId)],
);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  // PII: person name
  name: text("name").notNull(),
  // PII: email
  email: text("email"),
  // PII: phone
  phone: text("phone"),
  roleTitle: text("role_title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
},
  (t) => [index("idx_contacts_company").on(t.companyId)],
);

export const workers = pgTable("workers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  // PII: person name
  name: text("name").notNull(),
  // PII: national/person identifier where required for compliance docs
  personIdentifier: text("person_identifier"),
  tradeRole: text("trade_role"), // e.g. "welder", "fitter"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
},
  (t) => [index("idx_workers_company").on(t.companyId)],
);

/** Project images are moderated: nothing goes public before ops approval */
export const portfolioStatus = pgEnum("portfolio_status", [
  "pending",
  "approved",
  "rejected",
]);

export const portfolioItems = pgTable("portfolio_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  title: text("title").notNull(),
  description: text("description"),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  status: portfolioStatus("status").notNull().default("pending"),
  moderationNote: text("moderation_note"),
  moderatedBy: uuid("moderated_by").references(() => users.id),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index("idx_portfolio_items_company").on(t.companyId)],
);

/**
 * References collected and checked by Piotrr ops (Section 7 keeps a
 * review ENGINE out of scope; structured, ops-collected references are the
 * prescribed alternative). Client contact details stay off-platform.
 */
export const companyReferences = pgTable("company_references", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  projectTitle: text("project_title").notNull(),
  clientName: text("client_name").notNull(), // company name, never a person
  country: text("country").notNull(),
  year: integer("year"),
  scopeSummary: text("scope_summary"),
  contactAvailable: text("contact_available").notNull().default("on_request"),
  collectedBy: uuid("collected_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index("idx_company_references_company").on(t.companyId)],
);

export const capacityStatus = pgEnum("capacity_status", [
  "draft",
  "published",
  "archived",
]);

/** M2 uses these publicly; ops can create them from day one */
export const capacityListings = pgTable("capacity_listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  tradeId: uuid("trade_id").notNull(),
  headcount: integer("headcount").notNull(),
  certificationsSummary: text("certifications_summary"),
  /** Indicative rate so buyers can gauge cost before sending a request.
   *  A range, never a binding quote — the offer is where price is agreed. */
  indicativeRateMinMinor: integer("indicative_rate_min_minor"),
  indicativeRateMaxMinor: integer("indicative_rate_max_minor"),
  indicativeRateCurrency: text("indicative_rate_currency"),
  indicativeRateUnit: text("indicative_rate_unit"),
  earliestStart: timestamp("earliest_start", { withTimezone: true }),
  weeksAvailable: integer("weeks_available"),
  baseLocation: text("base_location"),
  status: capacityStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
},
  (t) => [index("idx_capacity_listings_company").on(t.companyId)],
);
