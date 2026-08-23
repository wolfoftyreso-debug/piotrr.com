import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/auth";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { gauge, render } from "@/lib/metrics";
import { logger } from "@/lib/logger";
import { companies } from "@/modules/companies/schema";
import { opsTasks, verificationCases, verificationItems } from "@/modules/verification/schema";
import { rfqs } from "@/modules/rfq/schema";

export const dynamic = "force-dynamic";

/**
 * Prometheus scrape endpoint.
 *
 * **Not public.** These numbers are commercially sensitive — how many
 * companies are verified, how many deals closed, how much work is in the
 * pipeline. A scraper presents a bearer token; the NetworkPolicy should
 * be the second lock, not the first.
 *
 * Business metrics answer the question §19 asks that technical health
 * cannot: "is the system actually *working*?" A pod can be green while
 * no supplier has been verified in a week and the review queue is
 * growing.
 */
const CACHE_MS = 10_000;
let cachedAt = 0;

async function refreshBusinessGauges(): Promise<void> {
  const now = Date.now();
  if (now - cachedAt < CACHE_MS) return; // a scrape every 15s must not be a load source
  cachedAt = now;

  const [caseRows, companyRows, taskRows, rfqRows, expiring] = await Promise.all([
    db.select({ state: verificationCases.state, n: sql<number>`count(*)::int` })
      .from(verificationCases).groupBy(verificationCases.state),
    db.select({ n: sql<number>`count(*)::int` })
      .from(companies).where(isNull(companies.deletedAt)),
    db.select({ n: sql<number>`count(*)::int` })
      .from(opsTasks).where(eq(opsTasks.status, "open")),
    db.select({ status: rfqs.status, n: sql<number>`count(*)::int` })
      .from(rfqs).groupBy(rfqs.status),
    db.select({ n: sql<number>`count(*)::int` }).from(verificationItems).where(
      and(
        eq(verificationItems.status, "approved"),
        gte(verificationItems.validUntil, new Date(now)),
        lte(verificationItems.validUntil, new Date(now + 30 * 24 * 3600 * 1000)),
      ),
    ),
  ]);

  for (const r of caseRows) {
    gauge("verification_cases", "Verification cases by state", r.n, { state: r.state });
  }
  gauge("companies_total", "Companies not soft-deleted", companyRows[0]?.n ?? 0);
  gauge("ops_tasks_open", "Open ops tasks — a growing queue means review is falling behind",
    taskRows[0]?.n ?? 0);
  for (const r of rfqRows) {
    gauge("rfqs", "Requests for quote by status", r.n, { status: r.status });
  }
  gauge("documents_expiring_30d",
    "Approved evidence expiring within 30 days; each one becomes a lapsed badge if ignored",
    expiring[0]?.n ?? 0);
}

export async function GET(request: Request) {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    // Fail closed. An unprotected /metrics is a business-intelligence
    // leak, so a missing token disables the endpoint rather than opening
    // it — the same reasoning as the production config guard.
    return NextResponse.json({ error: { message: "Metrics not configured" } }, { status: 404 });
  }
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secretEquals(presented, expected)) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  try {
    await refreshBusinessGauges();
    gauge("app_info", "Build and environment", 1, {
      env: env.NODE_ENV,
      version: process.env.APP_VERSION ?? "dev",
    });
  } catch (error) {
    // A metrics endpoint that 500s during an incident is a metrics
    // endpoint that is useless exactly when it is needed. Serve the
    // process-level series and mark the database ones stale.
    logger.warn({ err: error }, "business gauges unavailable for this scrape");
    gauge("business_gauges_stale", "1 when the last scrape could not read the database", 1);
  }

  return new NextResponse(render(), {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
