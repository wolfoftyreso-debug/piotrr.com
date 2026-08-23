import { NextResponse } from "next/server";
import { suppliersResponseSchema } from "@/lib/api-schemas";
import { handleApiError } from "@/lib/api";
import { searchSuppliers } from "@/modules/search/service";

export const dynamic = "force-dynamic";

/**
 * Public supplier search.
 *
 * Deliberately unauthenticated: this is the same data the public
 * directory renders, and a client that has to authenticate before it can
 * show a browse screen is a client that cannot have a browse screen.
 *
 * It exists because the web app reached the domain through 36 server
 * actions and 8 API endpoints — server actions being web-only RPC, so an
 * iOS or Android client could not browse at all. The business logic was
 * already in the right place (`modules/search/service`); only a
 * client-neutral way to reach it was missing.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? 30);
    const hits = await searchSuppliers({
      q: url.searchParams.get("q") ?? undefined,
      country: url.searchParams.get("country") ?? undefined,
      language: url.searchParams.get("language") ?? undefined,
      verifiedOnly: url.searchParams.get("verified") === "1",
      limit: Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 30,
    });
    // Parsed through the same strict contract the OpenAPI document and
    // test:contract use — an extra field here is a thrown error, not a
    // silent API change.
    return NextResponse.json(suppliersResponseSchema.parse({ data: hits, count: hits.length }));
  } catch (error) {
    return handleApiError(error);
  }
}
