import { NextResponse } from "next/server";
import { handleApiError, parseBody, readJsonBody, requireApiActor } from "@/lib/api";
import { transitionItemSchema } from "@/lib/api-schemas";
import { transitionItem } from "@/modules/verification/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiActor("verification:write");
    const { id } = await params;
    const input = parseBody(transitionItemSchema, await readJsonBody(request));
    const updated = await transitionItem(actor, id, input.status, input);
    return NextResponse.json({ data: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
