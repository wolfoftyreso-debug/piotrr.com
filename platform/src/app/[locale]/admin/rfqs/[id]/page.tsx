import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatMinor } from "@/lib/money";
import {
  getRfq,
  listDispatchedCompanyIds,
} from "@/modules/rfq/service";
import { getDealForRfq, listOffersForRfq } from "@/modules/offers/service";
import type { VerificationSnapshot } from "@/modules/offers/domain";
import { getCompany, listCompanies } from "@/modules/companies/service";
import {
  isCompanyVerified,
  resolveCompanyCorridorId,
} from "@/modules/verification/service";
import { getUserById } from "@/modules/identity/service";
import {
  dispatchRfqAction,
  markRfqStatusAction,
  qualifyRfqAction,
  recordDealAction,
} from "../actions";

export const dynamic = "force-dynamic";

/** Ops RFQ detail: qualify → select candidate suppliers → dispatch →
 * follow offers → record the deal on acceptance (M3) */
export default async function AdminRfqDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("adminRfq");
  const tStatus = await getTranslations("rfqStatus");

  const rfq = await getRfq(id);
  if (!rfq) notFound();

  const buyer = await getUserById(rfq.buyerUserId);
  const offers = await listOffersForRfq(rfq.id);
  const dispatchedIds = new Set(await listDispatchedCompanyIds(rfq.id));

  // Candidate suppliers with verification status on their own corridor
  const allCompanies = await listCompanies();
  const candidates = [] as { id: string; name: string; verified: boolean; dispatched: boolean }[];
  for (const company of allCompanies) {
    const corridorId = await resolveCompanyCorridorId(company.id, company.country);
    const verified = corridorId
      ? await isCompanyVerified(company.id, corridorId)
      : false;
    candidates.push({
      id: company.id,
      name: company.name,
      verified,
      dispatched: dispatchedIds.has(company.id),
    });
  }
  candidates.sort((a, b) => Number(b.verified) - Number(a.verified));

  const offerCompanies = new Map<string, string>();
  for (const offer of offers) {
    const company = await getCompany(offer.companyId);
    offerCompanies.set(offer.companyId, company?.name ?? "—");
  }
  const acceptedOffer = offers.find((o) => o.status === "accepted");
  const existingDeal = await getDealForRfq(rfq.id);

  return (
    <div>
      <p>
        <Link href={`/${locale}/admin/rfqs`}>← {t("title")}</Link>
      </p>
      <h1>{rfq.title}</h1>
      <p className="muted">
        <span className="badge">{tStatus(rfq.status)}</span>
        {" · "}{t("buyer")}: {buyer?.name ?? "—"} ({buyer?.email ?? "—"})
        {rfq.siteCity && <> · {rfq.siteCity}</>}
        {rfq.headcountNeeded && <> · {rfq.headcountNeeded} pax</>}
        {rfq.budgetAmountMinor != null && rfq.budgetCurrency && (
          <> · {formatMinor(rfq.budgetAmountMinor, rfq.budgetCurrency)}</>
        )}
      </p>

      <div className="card">
        <p style={{ whiteSpace: "pre-line", margin: 0 }}>{rfq.description}</p>
      </div>

      {/* Concierge actions */}
      <div className="card">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {rfq.status === "new" && (
            <form action={qualifyRfqAction}>
              <input type="hidden" name="rfqId" value={rfq.id} />
              <button type="submit">{t("qualify")}</button>
            </form>
          )}
          {!["accepted", "lost", "expired"].includes(rfq.status) && (
            <>
              <form action={markRfqStatusAction}>
                <input type="hidden" name="rfqId" value={rfq.id} />
                <input type="hidden" name="to" value="lost" />
                <button type="submit" className="danger">{t("markLost")}</button>
              </form>
              <form action={markRfqStatusAction}>
                <input type="hidden" name="rfqId" value={rfq.id} />
                <input type="hidden" name="to" value="expired" />
                <button type="submit" className="secondary">{t("markExpired")}</button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Dispatch */}
      {["qualified", "dispatched", "offers_in"].includes(rfq.status) && (
        <div className="card">
          <h3>{t("dispatchTitle")}</h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>{t("dispatchHint")}</p>
          <form action={dispatchRfqAction} style={{ display: "grid", gap: "0.6rem" }}>
            <input type="hidden" name="rfqId" value={rfq.id} />
            <div style={{ display: "grid", gap: "0.3rem" }}>
              {candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  style={{ display: "flex", gap: "0.4rem", alignItems: "center", margin: 0 }}
                >
                  <input
                    type="checkbox"
                    name="companyIds"
                    value={candidate.id}
                    disabled={candidate.dispatched}
                    defaultChecked={candidate.dispatched}
                  />
                  {candidate.name}
                  {candidate.verified ? (
                    <span className="badge verified">✓</span>
                  ) : (
                    <span className="badge">{t("unverified")}</span>
                  )}
                  {candidate.dispatched && (
                    <span className="muted" style={{ fontSize: "0.75rem" }}>
                      {t("alreadyDispatched")}
                    </span>
                  )}
                </label>
              ))}
            </div>
            <div className="inline" style={{ display: "flex", gap: "0.5rem" }}>
              <input name="note" placeholder={t("dispatchNote")} style={{ flex: 1 }} />
              <button type="submit">{t("dispatchCta")}</button>
            </div>
          </form>
        </div>
      )}

      {/* Offers */}
      <h2>{t("offers")} ({offers.length})</h2>
      {offers.map((offer) => {
        const snapshot = offer.verificationSnapshot as VerificationSnapshot;
        return (
          <div key={offer.id} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <strong>{offerCompanies.get(offer.companyId)}</strong>{" "}
                — {formatMinor(offer.amountMinor, offer.currency)} ({offer.rateModel})
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  {t("snapshot")}: {snapshot.companyVerified ? "✓ verified" : "not verified"}{" "}
                  @ {snapshot.frozenAt.slice(0, 16).replace("T", " ")} ·{" "}
                  {snapshot.team.length} {t("teamMembers")}
                </div>
              </div>
              <span className={`badge ${offer.status === "accepted" ? "approved" : offer.status === "rejected" ? "rejected" : "submitted"}`}>
                {offer.status}
              </span>
            </div>
          </div>
        );
      })}

      {/* Record deal */}
      {existingDeal && (
        <div className="card" style={{ borderColor: "var(--success)" }}>
          <h3 style={{ marginTop: 0 }}>
            <span className="badge approved">✓ {t("dealRecorded")}</span>
          </h3>
          <p className="muted" style={{ margin: 0 }}>
            {formatMinor(existingDeal.contractValueMinor, existingDeal.currency)}
            {" · "}{existingDeal.successFeePct}%
          </p>
        </div>
      )}
      {acceptedOffer && !existingDeal && (
        <div className="card" style={{ borderColor: "var(--success)" }}>
          <h3>{t("recordDealTitle")}</h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>{t("recordDealHint")}</p>
          <form action={recordDealAction} className="inline">
            <input type="hidden" name="offerId" value={acceptedOffer.id} />
            <div>
              <label htmlFor="d-value">{t("contractValue")}</label>
              <input id="d-value" name="contractValue" type="number" min={1} step="0.01" required />
            </div>
            <div>
              <label htmlFor="d-currency">{t("currency")}</label>
              <select id="d-currency" name="currency" defaultValue={acceptedOffer.currency}>
                <option value="EUR">EUR</option>
                <option value="SEK">SEK</option>
              </select>
            </div>
            <div>
              <label htmlFor="d-fee">{t("successFee")}</label>
              <input id="d-fee" name="successFeePct" type="number" min={0} max={100} step="0.5" defaultValue={8} required style={{ width: 80 }} />
            </div>
            <div>
              <label htmlFor="d-note">{t("note")}</label>
              <input id="d-note" name="note" />
            </div>
            <button type="submit">{t("recordDealCta")}</button>
          </form>
        </div>
      )}
    </div>
  );
}
