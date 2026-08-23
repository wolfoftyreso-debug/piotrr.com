import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { isDraining } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/**
 * Readiness: may this pod receive traffic right now?
 *
 * Separate from liveness on purpose. Both probes used to point at
 * /api/healthz, which checks the database — so a database blip failed
 * *liveness* on every replica at once and the kubelet restarted them all.
 * A dependency outage became a cluster-wide crash loop, and the restarts
 * did nothing to fix the dependency.
 *
 * Readiness is where a dependency check belongs: the pod stays alive,
 * stops receiving requests, and returns to service on its own when the
 * database comes back.
 */
export async function GET() {
  if (isDraining()) {
    // Shutting down: refuse traffic first so the endpoints controller
    // pulls this pod before the process goes away.
    return NextResponse.json({ status: "draining" }, { status: 503 });
  }
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json(
      { status: "not-ready", database: "unreachable" },
      { status: 503 },
    );
  }
}
