import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness: is this process still able to serve at all?
 *
 * Deliberately checks nothing external. Liveness failing means "kill this
 * container", which is the right answer for a wedged event loop and the
 * wrong answer for an unreachable database — restarting the app does not
 * bring Postgres back, and doing it on every replica at once turns a
 * dependency blip into an outage.
 *
 * Dependency health lives in /api/readyz.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
