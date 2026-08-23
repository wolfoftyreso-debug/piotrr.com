import { NextResponse } from "next/server";
import {
  handleApiError,
  pageParams,
  pageResponse,
  parseBody,
  readJsonBody,
  requireApiActor,
  withIdempotency,
} from "@/lib/api";
import { createCompanySchema } from "@/lib/api-schemas";
import {
  createCompany,
  listCompaniesPage,
  publicCompanyView,
} from "@/modules/companies/service";

export const dynamic = "force-dynamic";

/**
 * Cursor-paginated: ?limit=50&cursor=<opaque> (Section 4.5).
 *
 * The `companies:read` scope is enforced only for bearer keys, and a key
 * inherits its account's role — so a supplier or buyer (cookie session, or
 * their own key) reaches this list too. Raw rows carry internal CRM columns
 * (VAT, registry no, ownerUserId, import source), so only ops/admin get
 * them; everyone else gets the public projection.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireApiActor("companies:read");
    const { limit, cursor } = pageParams(request);
    const rows = await listCompaniesPage(limit, cursor);
    const isOps = actor.role === "ops" || actor.role === "admin";
    const shaped = isOps ? rows : rows.map(publicCompanyView);
    return NextResponse.json(pageResponse(shaped, limit));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor("companies:write");
    const raw = await readJsonBody(request);
    const input = parseBody(createCompanySchema, raw);

    return withIdempotency(request, input, async () => {
      const company = await createCompany(actor, input);
      return { status: 201, body: { data: company } };
    }, actor.userId);
  } catch (error) {
    return handleApiError(error);
  }
}
