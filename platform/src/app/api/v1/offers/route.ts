import { NextResponse } from "next/server";
import {
  apiError,
  handleApiError,
  parseBody,
  readJsonBody,
  requireApiActor,
  withIdempotency,
} from "@/lib/api";
import {
  listOffersForRfqAs,
  offerInputSchema,
  submitOffer,
} from "@/modules/offers/service";

export const dynamic = "force-dynamic";

/**
 * Offers on an RFQ (Section 5/M3), as a client-neutral endpoint rather than
 * a web-only server action. The service layer owns every authorization
 * rule; this route only authenticates and shapes the request/response.
 */

/** Offers visible to the caller for one RFQ: `?rfqId=<uuid>`. */
export async function GET(request: Request) {
  try {
    const actor = await requireApiActor("offers:read");
    const rfqId = new URL(request.url).searchParams.get("rfqId");
    if (!rfqId) return apiError(400, "rfqId query parameter is required");
    const offers = await listOffersForRfqAs(actor, rfqId);
    return NextResponse.json({ data: offers });
  } catch (error) {
    return handleApiError(error);
  }
}

/** A supplier (or ops on their behalf) submits an offer. */
export async function POST(request: Request) {
  try {
    const actor = await requireApiActor("offers:write");
    const input = parseBody(offerInputSchema, await readJsonBody(request));

    return await withIdempotency(request, input, async () => {
      const offer = await submitOffer(actor, input);
      return { status: 201, body: { data: { id: offer.id, status: offer.status } } };
    }, actor.userId);
  } catch (error) {
    return handleApiError(error);
  }
}
