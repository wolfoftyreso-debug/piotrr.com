import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Search module — read model over public supplier data (Postgres FTS +
 * trigram per Section 3). Read-only projection: it never mutates other
 * modules' tables; writes stay behind their service interfaces.
 */

export interface SupplierSearchHit {
  companyId: string;
  name: string;
  slug: string | null;
  country: string;
  city: string | null;
  description: string | null;
  languages: string[];
  yearFounded: number | null;
  headcount: number | null;
  verified: boolean;
  /** ISO country codes this company is verified for, e.g. ["DE", "SE"] */
  verifiedDestinations: string[];
  unclaimed: boolean;
  category: string | null;
  rank: number;
}

export interface SupplierSearchParams {
  q?: string;
  country?: string;
  language?: string;
  verifiedOnly?: boolean;
  limit?: number;
}

/**
 * Company text (name, description, city) is written in English, but buyers
 * search in their own language. Map a query that names a trade in any of
 * the six locales onto that trade's English name so "svetsning", "spawanie"
 * and "welding" all reach the same suppliers.
 */
async function expandTradeSynonym(q: string): Promise<string> {
  if (!q) return q;
  const needle = q.toLowerCase();
  const rows = await db.execute(sql`
    SELECT name_en FROM trades
    WHERE lower(name_sv) = ${needle} OR lower(name_lt) = ${needle}
       OR lower(name_lv) = ${needle} OR lower(name_et) = ${needle}
       OR lower(name_pl) = ${needle} OR lower(name_en) = ${needle}
    LIMIT 1
  `);
  const match = (rows.rows[0] as { name_en?: string } | undefined)?.name_en;
  return match ?? q;
}

export async function searchSuppliers(
  params: SupplierSearchParams,
): Promise<SupplierSearchHit[]> {
  const limit = Math.min(params.limit ?? 30, 100);
  const q = await expandTradeSynonym(params.q?.trim() ?? "");

  const rows = await db.execute(sql`
    SELECT
      c.id AS company_id,
      c.name,
      c.country,
      c.city,
      c.description,
      c.languages,
      c.year_founded,
      c.headcount,
      c.claim_status,
      c.category,
      (SELECT s.slug FROM company_slugs s
        WHERE s.company_id = c.id AND s.is_primary = 1
        ORDER BY s.created_at DESC LIMIT 1) AS slug,
      EXISTS (
        SELECT 1 FROM verification_cases vc
        WHERE vc.company_id = c.id AND vc.state = 'verified'
      ) AS verified,
      -- Which destinations the badge actually covers. A supplier verified
      -- for Sweden is not verified for Germany, and the card must not
      -- imply otherwise (Appendix B: matching is destination-aware).
      COALESCE((
        SELECT array_agg(DISTINCT co.to_country ORDER BY co.to_country)
        FROM verification_cases vc
        JOIN corridors co ON co.id = vc.corridor_id
        WHERE vc.company_id = c.id AND vc.state = 'verified'
      ), ARRAY[]::text[]) AS verified_destinations,
      CASE
        WHEN ${q} = '' THEN 0
        ELSE COALESCE(ts_rank(c.search_tsv, websearch_to_tsquery('simple', ${q})), 0)
             + similarity(c.name, ${q})
             + word_similarity(${q}, c.name)
      END AS rank
    FROM companies c
    WHERE c.deleted_at IS NULL
      AND (
        ${q} = ''
        OR c.search_tsv @@ websearch_to_tsquery('simple', ${q})
        OR c.name % ${q}
        -- Typo tolerance: word_similarity matches a misspelling against a
        -- single word of the name ("weldng" -> "Vilnius Weldworks UAB",
        -- scoring 0.57) where whole-string similarity would score only 0.16.
        -- 0.5 keeps genuine typos and rejects noise (nonsense peaks at 0.10).
        OR word_similarity(${q}, c.name) > 0.5
      )
      AND (${params.country ?? ""} = '' OR c.country = ${params.country ?? ""})
      AND (${params.language ?? ""} = '' OR ${params.language ?? ""} = ANY (c.languages))
      AND (
        ${params.verifiedOnly ?? false} = false
        OR EXISTS (
          SELECT 1 FROM verification_cases vc
          WHERE vc.company_id = c.id AND vc.state = 'verified'
        )
      )
    ORDER BY verified DESC, rank DESC, c.name ASC
    LIMIT ${limit}
  `);

  return (rows.rows as Record<string, unknown>[]).map((row) => ({
    companyId: String(row.company_id),
    name: String(row.name),
    slug: row.slug ? String(row.slug) : null,
    country: String(row.country),
    city: row.city ? String(row.city) : null,
    description: row.description ? String(row.description) : null,
    languages: (row.languages as string[]) ?? [],
    yearFounded: row.year_founded == null ? null : Number(row.year_founded),
    headcount: row.headcount == null ? null : Number(row.headcount),
    verified: row.verified === true,
    verifiedDestinations: (row.verified_destinations as string[]) ?? [],
    unclaimed: row.claim_status === "unclaimed",
    category: row.category ? String(row.category) : null,
    rank: Number(row.rank ?? 0),
  }));
}
