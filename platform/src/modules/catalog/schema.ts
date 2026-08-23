import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Catalog module: trades, corridors and requirement definitions.
 * New corridors/trades are SEED DATA, never code (Section 2).
 */

export const trades = pgTable("trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameEn: text("name_en").notNull(),
  nameSv: text("name_sv").notNull(),
  nameLt: text("name_lt").notNull(),
  nameLv: text("name_lv"),
  nameEt: text("name_et"),
  namePl: text("name_pl"),
  nameDe: text("name_de"),
  nameDa: text("name_da"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const corridors = pgTable("corridors", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // e.g. "lt-se"
  fromCountry: text("from_country").notNull(), // ISO 3166-1 alpha-2
  toCountry: text("to_country").notNull(),
  serviceType: text("service_type").notNull().default("entreprenad"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Who/what a requirement attaches to */
export const requirementScope = pgEnum("requirement_scope", [
  "company",
  "worker",
  "assignment",
]);

export const requirementDefinitions = pgTable("requirement_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  corridorId: uuid("corridor_id")
    .notNull()
    .references(() => corridors.id),
  tradeId: uuid("trade_id").references(() => trades.id), // null = applies to all trades
  key: text("key").notNull(), // stable machine key, e.g. "f_skatt"
  nameEn: text("name_en").notNull(),
  nameSv: text("name_sv").notNull(),
  nameLt: text("name_lt").notNull(),
  nameLv: text("name_lv"),
  nameEt: text("name_et"),
  namePl: text("name_pl"),
  nameDe: text("name_de"),
  nameDa: text("name_da"),
  descriptionEn: text("description_en"),
  scope: requirementScope("scope").notNull(),
  /** Critical requirements auto-expire the whole case when lapsed */
  critical: integer("critical").notNull().default(1), // 1 = critical, 0 = not
  /** Extra structured fields required for this item, as JSON schema hints */
  metadataSpec: jsonb("metadata_spec").notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Seeds rely on ON CONFLICT DO NOTHING being a real guard, not a no-op
  uniqueIndex("requirement_definitions_corridor_key_unique").on(
    table.corridorId,
    table.key,
  ),
]);
