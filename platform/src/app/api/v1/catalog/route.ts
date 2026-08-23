import { NextResponse } from "next/server";
import { catalogResponseSchema } from "@/lib/api-schemas";
import { handleApiError } from "@/lib/api";
import { listCorridors, listTrades } from "@/modules/catalog/service";

export const dynamic = "force-dynamic";

/**
 * Trades and corridors — the vocabulary every client needs before it can
 * render a filter, a trade picker or a corridor badge.
 *
 * Public and unauthenticated: this is reference data, and hard-coding it
 * into each client is exactly how web, iOS and Android drift into three
 * different ideas of what a corridor is. Corridors stay seed data
 * (CLAUDE.md §2), so this endpoint is their single published form.
 *
 * The response is PARSED through its own contract before it leaves: the
 * projection below is explicit (no `created_at`, no future column that a
 * `select *` happens to pick up), and `catalogResponseSchema` is strict,
 * so a leaked field is a thrown error here rather than a silent contract
 * change discovered by a client. The OpenAPI document and
 * `npm run test:contract` use the same schema.
 */
export async function GET() {
  try {
    const [trades, corridors] = await Promise.all([listTrades(), listCorridors()]);
    const payload = catalogResponseSchema.parse({
      data: {
        trades: trades.map((t) => ({
          id: t.id,
          slug: t.slug,
          nameEn: t.nameEn,
          nameSv: t.nameSv,
          nameLt: t.nameLt,
          nameLv: t.nameLv,
          nameEt: t.nameEt,
          namePl: t.namePl,
          nameDe: t.nameDe,
          nameDa: t.nameDa,
        })),
        corridors: corridors.map((c) => ({
          id: c.id,
          slug: c.slug,
          fromCountry: c.fromCountry,
          toCountry: c.toCountry,
          serviceType: c.serviceType,
        })),
      },
    });
    return NextResponse.json(payload);
  } catch (error) {
    return handleApiError(error);
  }
}
