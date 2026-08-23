import { localizedName } from "@/modules/catalog/i18n";
import { StatusBadge } from "@/components/brand/StatusBadge";
import { countryName } from "@/lib/countries";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirementDefinitions } from "@/modules/catalog/schema";
import { workers } from "@/modules/companies/schema";
import { getCorridorById } from "@/modules/catalog/service";
import { getCompany } from "@/modules/companies/service";
import { getCaseWithItems } from "@/modules/verification/service";
import { badgeVisible, type CaseState } from "@/modules/verification/domain";
import {
  transitionCaseAction,
  transitionItemAction,
} from "@/app/[locale]/admin/actions";

export const dynamic = "force-dynamic";

const CASE_ACTIONS: { to: CaseState; labelKey: string; from: CaseState[] }[] = [
  { to: "in_review", labelKey: "sendToReview", from: ["draft", "suspended", "expired"] },
  { to: "verified", labelKey: "markVerified", from: ["in_review", "suspended"] },
  { to: "suspended", labelKey: "suspend", from: ["verified"] },
  { to: "draft", labelKey: "backToDraft", from: ["in_review"] },
];

export default async function CaseDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verification");
  const tState = await getTranslations("caseState");
  const tItem = await getTranslations("itemStatus");

  const data = await getCaseWithItems(id);
  if (!data) notFound();
  const { case: kase, items } = data;

  const company = await getCompany(kase.companyId);

  const reqIds = [...new Set(items.map((i) => i.requirementDefinitionId))];
  const reqs = reqIds.length
    ? await db
        .select()
        .from(requirementDefinitions)
        .where(inArray(requirementDefinitions.id, reqIds))
    : [];
  const reqById = new Map(reqs.map((r) => [r.id, r]));

  const workerIds = [...new Set(items.flatMap((i) => (i.workerId ? [i.workerId] : [])))];
  const workerRows = workerIds.length
    ? await db
        .select({ id: workers.id, name: workers.name })
        .from(workers)
        .where(inArray(workers.id, workerIds))
    : [];
  const workerById = new Map(workerRows.map((w) => [w.id, w.name]));

  const state = kase.state as CaseState;
  // The badge must name the destination the case actually covers.
  const destination =
    countryName((await getCorridorById(kase.corridorId))?.toCountry ?? kase.corridorId, locale);

  return (
    <div>
      <h1>
        {t("caseTitle")}: {company?.name ?? kase.companyId}
      </h1>
      <p>
        <StatusBadge status={state} label={tState(state)} />{" "}
        {badgeVisible(state) ? (
          <span className="badge verified">
            ✓ {t("verifiedBadgeFor", { country: destination })}
          </span>
        ) : (
          <span className="badge">{t("notVerified")}</span>
        )}
      </p>

      <div className="card">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {CASE_ACTIONS.filter((a) => a.from.includes(state)).map((action) => (
            <form key={action.to} action={transitionCaseAction}>
              <input type="hidden" name="caseId" value={kase.id} />
              <input type="hidden" name="to" value={action.to} />
              <button
                type="submit"
                className={action.to === "suspended" ? "danger" : undefined}
              >
                {t(action.labelKey)}
              </button>
            </form>
          ))}
        </div>
      </div>

      <h2>{t("requirement")}</h2>
      {items.map((item) => {
        const req = reqById.get(item.requirementDefinitionId);
        const status = item.status;
        return (
          <div key={item.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <strong>{req ? localizedName(req, locale) : item.requirementDefinitionId}</strong>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {t("scope")}:{" "}
                  {req?.scope === "worker"
                    ? t("scopeWorker")
                    : req?.scope === "assignment"
                      ? t("scopeAssignment")
                      : t("scopeCompany")}
                  {item.workerId && (
                    <>
                      {" · "}
                      {t("worker")}: {workerById.get(item.workerId) ?? item.workerId}
                    </>
                  )}
                  {item.validUntil && (
                    <>
                      {" · "}
                      {t("validUntil")}:{" "}
                      {new Date(item.validUntil).toISOString().slice(0, 10)}
                    </>
                  )}
                </div>
                {item.decisionNote && (
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {t("decisionNote")}: {item.decisionNote}
                  </div>
                )}
              </div>
              <StatusBadge status={status} label={tItem(status)} />
            </div>

            <div className="mt" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {status === "missing" && (
                <ItemTransition itemId={item.id} to="submitted" label={t("markSubmitted")} withValidity />
              )}
              {status === "submitted" && (
                <ItemTransition itemId={item.id} to="in_review" label={t("startReview")} />
              )}
              {status === "in_review" && (
                <>
                  <ItemTransition itemId={item.id} to="approved" label={t("approve")} withNote withValidity />
                  <ItemTransition itemId={item.id} to="rejected" label={t("reject")} withNote danger />
                </>
              )}
              {(status === "rejected" || status === "expired") && (
                <ItemTransition itemId={item.id} to="submitted" label={t("resubmit")} withValidity />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ItemTransition({
  itemId,
  to,
  label,
  withNote,
  withValidity,
  danger,
}: {
  itemId: string;
  to: string;
  label: string;
  withNote?: boolean;
  withValidity?: boolean;
  danger?: boolean;
}) {
  return (
    <form action={transitionItemAction} className="inline">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="to" value={to} />
      {withNote && (
        <input name="decisionNote" placeholder="…" style={{ width: 180 }} />
      )}
      {withValidity && <input type="date" name="validUntil" />}
      <button type="submit" className={danger ? "danger" : "secondary"}>
        {label}
      </button>
    </form>
  );
}
