import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { corridors, requirementDefinitions, trades } from "./schema";
import { TRADE_SEED } from "./trade-seed";

export type RequirementDefinition =
  typeof requirementDefinitions.$inferSelect;
export type Corridor = typeof corridors.$inferSelect;
export type Trade = typeof trades.$inferSelect;

export async function listCorridors(): Promise<Corridor[]> {
  return db.select().from(corridors).orderBy(asc(corridors.slug));
}

export async function listTrades(): Promise<Trade[]> {
  return db.select().from(trades).orderBy(asc(trades.slug));
}

/** What a page needs to render a trade: an identity and eight names. */
export type TradeDisplay = Pick<
  Trade,
  | "id"
  | "slug"
  | "nameEn"
  | "nameSv"
  | "nameLt"
  | "nameLv"
  | "nameEt"
  | "namePl"
  | "nameDe"
  | "nameDa"
>;

/**
 * The trade list for a page that must render without a database.
 *
 * Two callers need this and no other: the prerendered home page, which is
 * generated in CI and in `docker build` where no database exists, and the
 * same page served while Postgres is down. Everything that *decides*
 * anything — search, filters, matching, dispatch — keeps reading the
 * table through `listTrades`, because a stale category list must never
 * silently narrow a result set.
 *
 * The fallback is the seed the table was filled from, not a second
 * opinion. A trade ops adds appears here at the next revalidation.
 */
export async function listTradesForDisplay(): Promise<TradeDisplay[]> {
  try {
    const rows = await listTrades();
    if (rows.length > 0) return rows;
    logger.warn("trades table is empty — rendering the seed catalogue");
  } catch (error) {
    logger.warn({ err: error }, "trades unavailable — rendering the seed catalogue");
  }
  return TRADE_SEED.map((t) => ({ ...t, id: t.slug }));
}

export async function getCorridorBySlug(slug: string): Promise<Corridor | undefined> {
  return db.query.corridors.findFirst({ where: eq(corridors.slug, slug) });
}

export async function getCorridorById(id: string): Promise<Corridor | undefined> {
  return db.query.corridors.findFirst({ where: eq(corridors.id, id) });
}

export async function getRequirementsForCorridor(
  corridorId: string,
): Promise<RequirementDefinition[]> {
  return db
    .select()
    .from(requirementDefinitions)
    .where(eq(requirementDefinitions.corridorId, corridorId))
    .orderBy(asc(requirementDefinitions.sortOrder));
}
