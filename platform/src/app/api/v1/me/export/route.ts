import { NextResponse } from "next/server";
import { handleApiError, requireApiActor } from "@/lib/api";
import { exportUserData } from "@/modules/identity/gdpr";

export const dynamic = "force-dynamic";

/**
 * GDPR data portability (Section 4.6): everything the platform holds about
 * the signed-in user, as a downloadable JSON file. Ops/admin can export
 * another subject with ?userId= when a request arrives by email.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireApiActor("profile:read");
    const target =
      new URL(request.url).searchParams.get("userId") ?? actor.userId;
    const data = await exportUserData(actor, target);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="piotrr-data-${target}.json"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
