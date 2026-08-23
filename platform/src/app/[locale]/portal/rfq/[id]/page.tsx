import { localizedName } from "@/modules/catalog/i18n";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { currentActor } from "@/lib/auth";
import { countryName } from "@/lib/countries";
import { formatMinor } from "@/lib/money";
import {
  getRfq,
  isCompanyDispatched,
  listAttachments,
} from "@/modules/rfq/service";
import { listOffersForRfq } from "@/modules/offers/service";
import type { VerificationSnapshot } from "@/modules/offers/domain";
import {
  getCompany,
  getCompanyByOwner,
  listWorkers,
} from "@/modules/companies/service";
import { listTrades } from "@/modules/catalog/service";
import {
  getOrCreateThread,
  listMessages,
} from "@/modules/messaging/service";
import { hasRole } from "@/modules/identity/rbac";
import {
  acceptOfferAction,
  sendThreadMessageAction,
  submitOfferAction,
} from "./actions";

export const dynamic = "force-dynamic";

function Snapshot({
  snapshot,
  labels,
}: {
  snapshot: VerificationSnapshot;
  labels: { verified: string; notVerified: string; frozenAt: string; team: string };
}) {
  return (
    <div style={{ fontSize: "0.85rem" }}>
      {snapshot.companyVerified ? (
        <span className="badge verified">✓ {labels.verified}</span>
      ) : (
        <span className="badge rejected">{labels.notVerified}</span>
      )}{" "}
      <span className="muted">
        {labels.frozenAt} {snapshot.frozenAt.slice(0, 10)} ·{" "}
        {snapshot.facts.length} ✓
      </span>
      {snapshot.team.length > 0 && (
        <div className="muted" style={{ marginTop: "0.25rem" }}>
          {labels.team}:{" "}
          {snapshot.team
            .map(
              (member) =>
                `${member.workerName}${member.approvedCerts.length > 0 ? ` (${member.approvedCerts.map((c) => c.requirementKey).join(", ")})` : ""}`,
            )
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

/** RFQ room — buyer comparison view / supplier offer view, with the
 * per-pair message thread (M3) */
export default async function RfqRoom({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const actor = await currentActor();
  if (!actor) redirect(`/${locale}/signin`);

  const rfq = await getRfq(id);
  if (!rfq) notFound();

  const t = await getTranslations("rfqRoom");
  const tStatus = await getTranslations("rfqStatus");

  const isBuyerOwner = actor.role === "buyer" && rfq.buyerUserId === actor.userId;
  const isOps = hasRole(actor, "ops");
  const myCompany =
    actor.role === "supplier" ? await getCompanyByOwner(actor.userId) : null;
  const isDispatchedSupplier = myCompany
    ? await isCompanyDispatched(rfq.id, myCompany.id)
    : false;

  if (!isBuyerOwner && !isOps && !isDispatchedSupplier) {
    notFound();
  }

  const [offers, attachments, trades] = await Promise.all([
    listOffersForRfq(rfq.id),
    listAttachments(rfq.id),
    listTrades(),
  ]);
  const trade = trades.find((tr) => tr.id === rfq.tradeId);

  const visibleOffers = isDispatchedSupplier && myCompany
    ? offers.filter((o) => o.companyId === myCompany.id)
    : offers;

  const offerCompanies = new Map<string, string>();
  for (const offer of visibleOffers) {
    const company = await getCompany(offer.companyId);
    offerCompanies.set(offer.companyId, company?.name ?? "—");
  }

  const myOpenOffer =
    myCompany && visibleOffers.find((o) => o.companyId === myCompany.id);
  const canSubmitOffer =
    isDispatchedSupplier &&
    myCompany &&
    !myOpenOffer &&
    ["dispatched", "offers_in"].includes(rfq.status);
  const myWorkers = canSubmitOffer && myCompany ? await listWorkers(myCompany.id) : [];

  // Thread: supplier ↔ buyer per pair. Buyer sees one thread per offering
  // company; supplier sees exactly their own.
  const threadCompanyIds = isDispatchedSupplier && myCompany
    ? [myCompany.id]
    : [...new Set(visibleOffers.map((o) => o.companyId))];
  const threads = [] as {
    companyId: string;
    companyName: string;
    messages: Awaited<ReturnType<typeof listMessages>>;
  }[];
  if (isBuyerOwner || isDispatchedSupplier) {
    for (const companyId of threadCompanyIds) {
      const thread = await getOrCreateThread(actor, rfq.id, companyId);
      const messages = await listMessages(actor, thread.id);
      const company = await getCompany(companyId);
      threads.push({ companyId, companyName: company?.name ?? "—", messages });
    }
  }

  const snapshotLabels = {
    // The snapshot was frozen for THIS request, so it speaks about the
    // country the work is actually performed in.
    verified: t("snapVerifiedFor", { country: countryName(rfq.siteCountry, locale) }),
    notVerified: t("snapNotVerified"),
    frozenAt: t("snapFrozenAt"),
    team: t("snapTeam"),
  };

  return (
    <div className="main" style={{ margin: "0 auto" }}>
      <p>
        <Link href={`/${locale}/portal`}>← {t("back")}</Link>
      </p>
      <h1>{rfq.title}</h1>
      <p className="muted">
        <span className={`badge ${rfq.status === "accepted" ? "verified" : rfq.status === "offers_in" ? "in_review" : ""}`}>
          {tStatus(rfq.status)}
        </span>
        {trade && <> · {localizedName(trade, locale)}</>}
        {rfq.headcountNeeded && <> · {rfq.headcountNeeded} {t("workers")}</>}
        {rfq.siteCity && <> · {rfq.siteCity}</>}
        {rfq.startDate && <> · {t("start")} {new Date(rfq.startDate).toISOString().slice(0, 10)}</>}
        {rfq.durationWeeks && <> · {rfq.durationWeeks} {t("weeks")}</>}
        {rfq.budgetAmountMinor != null && rfq.budgetCurrency && (
          <> · {t("budget")}: {formatMinor(rfq.budgetAmountMinor, rfq.budgetCurrency)}</>
        )}
      </p>

      <div className="card">
        <p style={{ whiteSpace: "pre-line", margin: 0 }}>{rfq.description}</p>
        {attachments.length > 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            {t("attachments")}: {attachments.map((a) => a.fileName).join(", ")}
          </p>
        )}
      </div>

      {/* Offers */}
      <h2>{t("offersTitle")} ({visibleOffers.length})</h2>
      {visibleOffers.length === 0 && (
        <p className="muted">{t("noOffers")}</p>
      )}
      {visibleOffers.map((offer) => (
        <div key={offer.id} className="card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ marginBottom: "0.2rem" }}>
                {offerCompanies.get(offer.companyId)}
              </h3>
              <div>
                <strong>{formatMinor(offer.amountMinor, offer.currency)}</strong>{" "}
                <span className="muted">
                  ({offer.rateModel === "hourly" ? t("hourly") : t("fixed")})
                </span>
                {offer.earliestStart && (
                  <span className="muted">
                    {" "}· {t("earliestStart")}: {new Date(offer.earliestStart).toISOString().slice(0, 10)}
                  </span>
                )}
                {offer.validUntil && (
                  <span className="muted">
                    {" "}· {t("validUntil")}: {new Date(offer.validUntil).toISOString().slice(0, 10)}
                  </span>
                )}
              </div>
              {offer.note && (
                <p className="muted" style={{ fontSize: "0.9rem" }}>{offer.note}</p>
              )}
              <Snapshot
                snapshot={offer.verificationSnapshot as VerificationSnapshot}
                labels={snapshotLabels}
              />
            </div>
            <div style={{ textAlign: "right" }}>
              <span className={`badge ${offer.status === "accepted" ? "approved" : offer.status === "rejected" ? "rejected" : "submitted"}`}>
                {offer.status}
              </span>
              {(isBuyerOwner || isOps) && offer.status === "submitted" && (
                <form action={acceptOfferAction} className="mt">
                  <input type="hidden" name="offerId" value={offer.id} />
                  <button type="submit">{t("accept")}</button>
                </form>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Supplier: submit offer */}
      {canSubmitOffer && myCompany && (
        <div className="card">
          <h3>{t("submitOfferTitle")}</h3>
          <form action={submitOfferAction} style={{ display: "grid", gap: "0.75rem", maxWidth: 560 }}>
            <input type="hidden" name="rfqId" value={rfq.id} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
              <div>
                <label htmlFor="o-rate">{t("rateModel")}</label>
                <select id="o-rate" name="rateModel" required>
                  <option value="fixed">{t("fixed")}</option>
                  <option value="hourly">{t("hourly")}</option>
                </select>
              </div>
              <div>
                <label htmlFor="o-amount">{t("amount")}</label>
                <input id="o-amount" name="amount" type="number" min={1} step="0.01" required />
              </div>
              <div>
                <label htmlFor="o-currency">{t("currency")}</label>
                <select id="o-currency" name="currency" defaultValue="EUR">
                  <option value="EUR">EUR</option>
                  <option value="SEK">SEK</option>
                </select>
              </div>
              <div>
                <label htmlFor="o-start">{t("earliestStart")}</label>
                <input id="o-start" name="earliestStart" type="date" />
              </div>
              <div>
                <label htmlFor="o-valid">{t("validUntil")}</label>
                <input id="o-valid" name="validUntil" type="date" />
              </div>
            </div>
            <div>
              <label>{t("team")} *</label>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                {myWorkers.map((worker) => (
                  <label key={worker.id} style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center", margin: 0 }}>
                    <input type="checkbox" name="workerIds" value={worker.id} />
                    {worker.name}
                    {worker.tradeRole && <span className="muted">({worker.tradeRole})</span>}
                  </label>
                ))}
              </div>
              <p className="muted" style={{ fontSize: "0.8rem" }}>{t("teamHint")}</p>
            </div>
            <div>
              <label htmlFor="o-note">{t("offerNote")}</label>
              <textarea id="o-note" name="note" rows={3} style={{ width: "100%" }} />
            </div>
            <div>
              <button type="submit">{t("submitOfferCta")}</button>
            </div>
          </form>
        </div>
      )}

      {/* Threads */}
      {threads.map((thread) => (
        <div key={thread.companyId} className="card">
          <h3>
            {t("threadTitle")} {isBuyerOwner ? `— ${thread.companyName}` : ""}
          </h3>
          <div style={{ maxHeight: 280, overflowY: "auto", display: "grid", gap: "0.4rem" }}>
            {thread.messages.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>{t("threadEmpty")}</p>
            )}
            {thread.messages.map((message) => {
              const mine = message.senderUserId === actor.userId;
              return (
                <div
                  key={message.id}
                  style={{
                    justifySelf: mine ? "end" : "start",
                    background: mine ? "var(--primary)" : "var(--bg)",
                    color: mine ? "#fff" : "inherit",
                    borderRadius: 10,
                    padding: "0.4rem 0.7rem",
                    maxWidth: "75%",
                    fontSize: "0.9rem",
                  }}
                >
                  {message.body}
                  <div style={{ fontSize: "0.65rem", opacity: 0.7 }}>
                    {new Date(message.createdAt).toISOString().slice(0, 16).replace("T", " ")}
                  </div>
                </div>
              );
            })}
          </div>
          <form action={sendThreadMessageAction} className="inline mt">
            <input type="hidden" name="rfqId" value={rfq.id} />
            <input type="hidden" name="companyId" value={thread.companyId} />
            <input name="body" required placeholder={t("threadPlaceholder")} style={{ flex: 1, minWidth: 220 }} />
            <button type="submit">{t("threadSend")}</button>
          </form>
        </div>
      ))}
    </div>
  );
}
