import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies } from "@/modules/companies/schema";
import {
  opsTasks,
  verificationItems,
} from "@/modules/verification/schema";
import { listCasesByState } from "@/modules/verification/service";
import { listRfqsByStatus } from "@/modules/rfq/service";
import { StatusBadge } from "@/components/brand/StatusBadge";

export const dynamic = "force-dynamic";

/** Avg hours from RFQ creation to dispatch — the ops time-to-match KPI */
function timeToMatchHours(
  rfqs: { createdAt: Date; statusChangedAt: Date; status: string }[],
): number | null {
  const matched = rfqs.filter((r) =>
    ["dispatched", "offers_in", "accepted"].includes(r.status),
  );
  if (matched.length === 0) return null;
  const totalMs = matched.reduce(
    (sum, r) => sum + (r.statusChangedAt.getTime() - r.createdAt.getTime()),
    0,
  );
  return Math.round(totalMs / matched.length / 36e5);
}

/**
 * Approved items whose validity ends inside the next 30 days.
 *
 * Kept outside the component: reading the clock is impure, and the
 * react-hooks purity rule rightly refuses it during render. This page is
 * `force-dynamic`, so the query runs per request — the clock read belongs
 * to the data layer, not to the render.
 */
async function countExpiringSoon(): Promise<number> {
  const now = Date.now();
  const rows = await db
    .select({ id: verificationItems.id })
    .from(verificationItems)
    .where(
      and(
        eq(verificationItems.status, "approved"),
        gte(verificationItems.validUntil, new Date(now)),
        lte(verificationItems.validUntil, new Date(now + 30 * 24 * 60 * 60 * 1000)),
      ),
    );
  return rows.length;
}

export default async function AdminDashboard({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const tState = await getTranslations("caseState");

  const [cases, allCompanies, openTasks, expiring, rfqsByStatus] = await Promise.all([
    listCasesByState(),
    db.select({ id: companies.id }).from(companies).where(isNull(companies.deletedAt)),
    db.select({ id: opsTasks.id }).from(opsTasks).where(eq(opsTasks.status, "open")),
    countExpiringSoon(),
    listRfqsByStatus(),
  ]);

  const openRfqs =
    rfqsByStatus.new.length +
    rfqsByStatus.qualified.length +
    rfqsByStatus.dispatched.length +
    rfqsByStatus.offers_in.length;
  const allRfqs = Object.values(rfqsByStatus).flat();
  const ttm = timeToMatchHours(allRfqs);

  return (
    <div>
      <h1>{t("title")}</h1>

      <div className="grid cols-4 mt">
        <div className="card stat">
          <div className="value">{allCompanies.length}</div>
          <div className="label">{t("companies")}</div>
        </div>
        <div className="card stat">
          <div className="value">{cases.in_review.length}</div>
          <div className="label">{tState("in_review")}</div>
        </div>
        <div className="card stat">
          <div className="value">{openTasks.length}</div>
          <div className="label">{t("openTasks")}</div>
        </div>
        <div className="card stat">
          <div className="value">{expiring}</div>
          <div className="label">{t("expiringSoon")}</div>
        </div>
        <div className="card stat">
          <div className="value">{openRfqs}</div>
          <div className="label">{t("openRfqs")}</div>
        </div>
        <div className="card stat">
          <div className="value">{ttm != null ? `${ttm}h` : "—"}</div>
          <div className="label">{t("timeToMatch")}</div>
        </div>
      </div>

      <h2>{t("casesByState")}</h2>
      <div className="grid cols-5">
        {(Object.keys(cases) as (keyof typeof cases)[]).map((state) => (
          <div key={state} className="card stat">
            <div className="value">{cases[state].length}</div>
            <div className="label">
              <StatusBadge status={state} label={tState(state)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
