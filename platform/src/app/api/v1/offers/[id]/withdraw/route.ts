import { NextResponse } from "next/server";
import { handleApiError, requireApiActor } from "@/lib/api";
import { withdrawOffer } from "@/modules/offers/service";

export const dynamic = "force-dynamic";

/**
 * The offering supplier (or ops/admin) withdraws an offer. The service
 * checks ownership and that the offer's state permits withdrawal.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiActor("offers:write");
    const { id } = await params;
    await withdrawOffer(actor, id);
    return NextResponse.json({ data: { id, status: "withdrawn" } });
  } catch (error) {
    return handleApiError(error);
  }
}
