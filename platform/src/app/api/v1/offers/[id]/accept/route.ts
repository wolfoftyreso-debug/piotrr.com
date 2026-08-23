import { NextResponse } from "next/server";
import { handleApiError, requireApiActor } from "@/lib/api";
import { acceptOffer } from "@/modules/offers/service";

export const dynamic = "force-dynamic";

/**
 * The RFQ's buyer (or ops/admin) accepts an offer. Access, offer-state and
 * validity (a lapsed quote is refused) are all enforced in the service.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiActor("offers:write");
    const { id } = await params;
    const offer = await acceptOffer(actor, id);
    return NextResponse.json({ data: { id: offer.id, status: offer.status } });
  } catch (error) {
    return handleApiError(error);
  }
}
