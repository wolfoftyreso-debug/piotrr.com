import { NextResponse } from "next/server";
import { handleApiError, requireApiActor } from "@/lib/api";
import { confirmUploadAs } from "@/modules/documents/service";

export const dynamic = "force-dynamic";

/**
 * Step 2: the client has finished its presigned PUT — enqueue the malware
 * scan. A supplier may confirm only a document belonging to their own
 * company (checked in the service); ops/admin may confirm any.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiActor("documents:write");
    const { id } = await params;
    await confirmUploadAs(actor, id);
    return NextResponse.json({ data: { documentId: id, status: "scanning" } });
  } catch (error) {
    return handleApiError(error);
  }
}
