import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { currentActor, secretEquals } from "@/lib/auth";
import { hasRole } from "@/modules/identity/rbac";
import { runExpirySweep } from "@/modules/verification/service";
import { expireStaleOffers } from "@/modules/offers/service";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * HTTP cron endpoint for the expiry engine. pg-boss runs this nightly
 * in-process; EventBridge Scheduler may also hit this endpoint (Section 3).
 * Auth: CRON_SECRET bearer token, or a signed-in admin/ops user.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const bearerOk = !!secret && secretEquals(bearer, secret);

  if (!bearerOk) {
    const actor = await currentActor();
    if (!actor || !hasRole(actor, "ops")) {
      return apiError(403, "Forbidden");
    }
  }

  const now = new Date();
  const result = await runExpirySweep(now);
  const expiredOffers = await expireStaleOffers(now);
  logger.info({ ...result, expiredOffers }, "expiry sweep finished");
  return NextResponse.json({ data: { ...result, expiredOffers } });
}
