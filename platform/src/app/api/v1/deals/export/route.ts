import { handleApiError, requireApiActor } from "@/lib/api";
import { dealsCsv } from "@/modules/offers/service";

export const dynamic = "force-dynamic";

/** Deal export for manual invoicing (M3 DoD) — ops/admin only */
export async function GET() {
  try {
    const actor = await requireApiActor("deals:read");
    const csv = await dealsCsv(actor);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="piotrr-deals.csv"',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
