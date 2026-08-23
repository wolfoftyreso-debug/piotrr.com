import { localizedName } from "@/modules/catalog/i18n";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { currentActor, currentUser, signOut } from "@/lib/auth";
import { getCorridorById } from "@/modules/catalog/service";
import { countryName } from "@/lib/countries";
import {
  getCompanyByOwner,
  getPrimarySlug,
  listCompanyCapacity,
  listPortfolio,
  listWorkers,
} from "@/modules/companies/service";
import UploadPortfolio from "./upload-portfolio";
import SetPasswordForm from "./set-password-form";
import { listTrades } from "@/modules/catalog/service";
import {
  listDispatchesForCompany,
  listRfqsForBuyer,
} from "@/modules/rfq/service";
import UploadEvidence from "./upload-evidence";
import {
  archiveMyCapacityAction,
  createMyCapacityAction,
  updateMyProfileAction,
} from "./actions";
import { LANGUAGE_OPTIONS } from "./languages";
import { requirementDefinitions } from "@/modules/catalog/schema";
import {
  verificationCases,
  verificationItems,
} from "@/modules/verification/schema";
import { badgeVisible, type CaseState } from "@/modules/verification/domain";
import { hasRole } from "@/modules/identity/rbac";
import { addMyWorkerAction, createMyCompanyAction } from "./actions";
import { PiotrrWordmark } from "@/components/brand/PiotrrWordmark";
import { StatusBadge } from "@/components/brand/StatusBadge";

export const dynamic = "force-dynamic";

/**
 * Self-service portal (thin, per M2): suppliers manage their company and
 * follow their verification case; buyers get their account surface (RFQ
 * intake arrives with M3).
 */
export default async function Portal({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await currentActor();
  if (!actor) redirect(`/${locale}/signin`);
  if (hasRole(actor, "ops")) redirect(`/${locale}/admin`);

  const user = await currentUser();
  const t = await getTranslations("portal");
  const common = await getTranslations("common");
  const tState = await getTranslations("caseState");
  const tItem = await getTranslations("itemStatus");
  const tCompanies = await getTranslations("companies");

  const isSupplier = actor.role === "supplier";
  const company = isSupplier ? await getCompanyByOwner(actor.userId) : null;

  const kase = company
    ? await db.query.verificationCases.findFirst({
        where: eq(verificationCases.companyId, company.id),
      })
    : null;

  const destination = kase
    ? countryName(((await getCorridorById(kase.corridorId))?.toCountry ?? ""), locale)
    : "";

  const items = kase
    ? await db
        .select()
        .from(verificationItems)
        .where(and(eq(verificationItems.caseId, kase.id)))
    : [];

  const reqIds = [...new Set(items.map((i) => i.requirementDefinitionId))];
  const reqs = reqIds.length
    ? await db
        .select()
        .from(requirementDefinitions)
        .where(inArray(requirementDefinitions.id, reqIds))
    : [];
  const reqById = new Map(reqs.map((r) => [r.id, r]));

  const workers = company ? await listWorkers(company.id) : [];
  const state = kase?.state as CaseState | undefined;
  const capacity = company ? await listCompanyCapacity(company.id, false) : [];
  const portfolio = company
    ? await listPortfolio(company.id, { onlyApproved: false })
    : [];
  const trades = company ? await listTrades() : [];
  const primarySlug = company ? await getPrimarySlug(company.id) : null;

  return (
    <div className="main" style={{ margin: "0 auto" }}>
      <div className="topbar">
        <Link href={`/${locale}`} className="brand" style={{ fontWeight: 800 }}>
          <PiotrrWordmark />
        </Link>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
          <span className="muted">{user?.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut();
              redirect(`/${locale}`);
            }}
          >
            <button className="secondary" type="submit">
              {common("signOut")}
            </button>
          </form>
        </div>
      </div>

      <h1>{t("title")}</h1>

      {/* Buyer surface */}
      {!isSupplier && (
        <>
          <div className="card mt">
            <h3>{t("buyerWelcome")}</h3>
            <p className="muted">{t("buyerBody")}</p>
            <Link className="button" href={`/${locale}/request-work`}>
              {t("newRequestCta")}
            </Link>
          </div>
          <BuyerRequests locale={locale} userId={actor.userId} />
        </>
      )}

      {/* Supplier without a company yet: create it */}
      {isSupplier && !company && (
        <div className="card mt">
          <h3>{t("createCompanyTitle")}</h3>
          <p className="muted">{t("createCompanyBody")}</p>
          <form
            action={createMyCompanyAction}
            style={{ display: "grid", gap: "0.75rem", maxWidth: 480 }}
            className="mt"
          >
            <div>
              <label htmlFor="name">{tCompanies("name")}</label>
              <input id="name" name="name" required minLength={2} style={{ width: "100%" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "0.5rem" }}>
              <div>
                <label htmlFor="country">{tCompanies("country")}</label>
                <select id="country" name="country" required defaultValue="LT">
                  <option value="LT">Lietuva</option>
                  <option value="LV">Latvija</option>
                  <option value="EE">Eesti</option>
                  <option value="PL">Polska</option>
                </select>
              </div>
              <div>
                <label htmlFor="city">{tCompanies("city")}</label>
                <input id="city" name="city" style={{ width: "100%" }} />
              </div>
            </div>
            <div>
              <label htmlFor="registrationNumber">{tCompanies("registrationNumber")}</label>
              <input id="registrationNumber" name="registrationNumber" style={{ width: "100%" }} />
            </div>
            <div>
              <label htmlFor="vatNumber">{tCompanies("vatNumber")}</label>
              <input id="vatNumber" name="vatNumber" style={{ width: "100%" }} />
            </div>
            <div>
              <label htmlFor="description">{t("companyDescription")}</label>
              <textarea id="description" name="description" rows={3} style={{ width: "100%" }} />
            </div>
            <button type="submit">{t("createCompanyCta")}</button>
          </form>
        </div>
      )}

      {/* Supplier with a company */}
      {isSupplier && company && (
        <>
          <SupplierDispatches locale={locale} companyId={company.id} />
          <div className="card mt">
            <h3>{company.name}</h3>
            <p className="muted">
              {company.country}
              {company.city ? ` · ${company.city}` : ""}
              {company.vatNumber ? ` · ${tCompanies("vatNumber")}: ${company.vatNumber}` : ""}
            </p>
            <p>
              {state ? (
                <>
                  <StatusBadge status={state} label={tState(state)} />{" "}
                  {badgeVisible(state) && (
                    <span className="badge verified">
                      ✓ {t("verifiedBadgeFor", { country: destination })}
                    </span>
                  )}
                </>
              ) : (
                <span className="muted">{t("awaitingCase")}</span>
              )}
              {primarySlug && (
                <>
                  {" · "}
                  <Link href={`/${locale}/company/${primarySlug}`}>
                    {t("publicProfileLink")}
                  </Link>
                </>
              )}
            </p>
          </div>

          {items.length > 0 && (
            <div className="card">
              <h3>{t("requirements")}</h3>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                {t("requirementsHint")}
              </p>
              <table>
                <tbody>
                  {items.map((item) => {
                    const req = reqById.get(item.requirementDefinitionId);
                    const needsEvidence = ["missing", "rejected", "expired"].includes(
                      item.status,
                    );
                    return (
                      <tr key={item.id}>
                        <td>{req ? localizedName(req, locale) : "—"}</td>
                        <td>
                          <span className={`badge ${item.status}`}>
                            {tItem(item.status)}
                          </span>
                        </td>
                        <td className="muted">
                          {item.validUntil
                            ? new Date(item.validUntil).toISOString().slice(0, 10)
                            : ""}
                        </td>
                        <td>
                          {needsEvidence && (
                            <UploadEvidence
                              itemId={item.id}
                              documentType={req?.key ?? "evidence"}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Profile editing — the Alibaba-style storefront data */}
          <div className="card">
            <h3>{t("editProfileTitle")}</h3>
            <form
              action={updateMyProfileAction}
              style={{ display: "grid", gap: "0.75rem", maxWidth: 520 }}
            >
              <div>
                <label htmlFor="p-description">{t("companyDescription")}</label>
                <textarea
                  id="p-description"
                  name="description"
                  rows={4}
                  defaultValue={company.description ?? ""}
                  style={{ width: "100%" }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label htmlFor="p-city">{tCompanies("city")}</label>
                  <input id="p-city" name="city" defaultValue={company.city ?? ""} />
                </div>
                <div>
                  <label htmlFor="p-website">{t("website")}</label>
                  <input id="p-website" name="website" defaultValue={company.website ?? ""} />
                </div>
                <div>
                  <label htmlFor="p-year">{t("yearFounded")}</label>
                  <input
                    id="p-year"
                    name="yearFounded"
                    type="number"
                    min={1900}
                    max={2100}
                    defaultValue={company.yearFounded ?? ""}
                  />
                </div>
                <div>
                  <label htmlFor="p-headcount">{t("headcount")}</label>
                  <input
                    id="p-headcount"
                    name="headcount"
                    type="number"
                    min={1}
                    defaultValue={company.headcount ?? ""}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="p-certs">{t("certificationsLabel")}</label>
                <input
                  id="p-certs"
                  name="certifications"
                  placeholder="ISO 9606-1, EN 1090 EXC2, ID06…"
                  defaultValue={company.certifications.join(", ")}
                  style={{ width: "100%" }}
                />
                <span className="muted" style={{ fontSize: "0.75rem" }}>
                  {t("certificationsHint")}
                </span>
              </div>
              <div>
                <label htmlFor="p-awards">{t("awardsLabel")}</label>
                <input
                  id="p-awards"
                  name="awards"
                  placeholder="Gazele Biznesu 2023…"
                  defaultValue={company.awards.join(", ")}
                  style={{ width: "100%" }}
                />
                <span className="muted" style={{ fontSize: "0.75rem" }}>
                  {t("certificationsHint")}
                </span>
              </div>
              <div>
                <label htmlFor="p-areas">{t("serviceAreasLabel")}</label>
                <input
                  id="p-areas"
                  name="serviceAreas"
                  placeholder="Stockholm, Mälardalen, hela Sverige…"
                  defaultValue={company.serviceAreas.join(", ")}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label>{t("languagesLabel")}</label>
                <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap" }}>
                  {LANGUAGE_OPTIONS.map((lang) => (
                    <label
                      key={lang}
                      style={{ display: "inline-flex", gap: "0.25rem", alignItems: "center", margin: 0 }}
                    >
                      <input
                        type="checkbox"
                        name="languages"
                        value={lang}
                        defaultChecked={company.languages.includes(lang)}
                      />
                      {lang.toUpperCase()}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <button type="submit">{common("save")}</button>
              </div>
            </form>
          </div>

          {/* Portfolio — project images, moderated by ops before going public */}
          <div className="card">
            <h3>{t("portfolioSection")}</h3>
            {portfolio.length > 0 && (
              <table>
                <tbody>
                  {portfolio.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.title}</strong>
                        {item.description && (
                          <div className="muted" style={{ fontSize: "0.8rem" }}>
                            {item.description}
                          </div>
                        )}
                        {item.status === "rejected" && item.moderationNote && (
                          <div style={{ color: "var(--danger)", fontSize: "0.8rem" }}>
                            {item.moderationNote}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${item.status === "approved" ? "approved" : item.status === "rejected" ? "rejected" : "submitted"}`}>
                          {t(`portfolioStatus_${item.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt">
              <UploadPortfolio />
            </div>
          </div>

          {/* Capacity listings — "our teams are available" */}
          <div className="card">
            <h3>{t("capacityTitle")}</h3>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              {t("capacityHint")}
            </p>
            {capacity.length > 0 && (
              <table>
                <tbody>
                  {capacity.map((listing) => {
                    const trade = trades.find((tr) => tr.id === listing.tradeId);
                    return (
                      <tr key={listing.id}>
                        <td>
                          <strong>{trade ? localizedName(trade, locale) : "—"}</strong>
                          {" · "}
                          {listing.headcount} {t("capacityWorkers")}
                        </td>
                        <td className="muted">
                          {listing.earliestStart
                            ? new Date(listing.earliestStart).toISOString().slice(0, 10)
                            : ""}
                          {listing.weeksAvailable ? ` · ${listing.weeksAvailable} v` : ""}
                        </td>
                        <td>
                          <span className={`badge ${listing.status === "published" ? "approved" : ""}`}>
                            {listing.status}
                          </span>
                        </td>
                        <td>
                          {listing.status !== "archived" && (
                            <form action={archiveMyCapacityAction}>
                              <input type="hidden" name="listingId" value={listing.id} />
                              <button type="submit" className="secondary">
                                {t("capacityArchive")}
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <form action={createMyCapacityAction} className="inline mt">
              <div>
                <label htmlFor="c-trade">{t("capacityTrade")}</label>
                <select id="c-trade" name="tradeId" required>
                  {trades.map((trade) => (
                    <option key={trade.id} value={trade.id}>
                      {localizedName(trade, locale)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="c-headcount">{t("capacityWorkers")}</label>
                <input id="c-headcount" name="headcount" type="number" min={1} required style={{ width: 80 }} />
              </div>
              <div>
                <label htmlFor="c-start">{t("capacityStart")}</label>
                <input id="c-start" name="earliestStart" type="date" />
              </div>
              <div>
                <label htmlFor="c-weeks">{t("capacityWeeks")}</label>
                <input id="c-weeks" name="weeksAvailable" type="number" min={1} style={{ width: 70 }} />
              </div>
              <div>
                <label htmlFor="c-certs">{t("capacityCerts")}</label>
                <input id="c-certs" name="certificationsSummary" placeholder="ISO 9606-1: 135, 136…" />
              </div>
              <div>
                <label htmlFor="c-rate">{t("indicativeRate")}</label>
                <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                  <input id="c-rate" name="rateMin" type="number" min={0} placeholder="480" style={{ width: 80 }} />
                  <span className="muted">–</span>
                  <input name="rateMax" type="number" min={0} placeholder="620" style={{ width: 80 }} />
                  <select name="rateCurrency" defaultValue="SEK">
                    <option>SEK</option><option>EUR</option><option>DKK</option>
                    <option>NOK</option><option>PLN</option><option>CZK</option>
                  </select>
                  <select name="rateUnit" defaultValue="hour">
                    <option value="hour">/tim</option>
                    <option value="day">/dag</option>
                  </select>
                </div>
                <span className="muted" style={{ fontSize: "0.75rem" }}>{t("indicativeRateHint")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", paddingBottom: "0.4rem" }}>
                <input type="checkbox" id="c-publish" name="publish" defaultChecked />
                <label htmlFor="c-publish" style={{ margin: 0 }}>{t("capacityPublish")}</label>
              </div>
              <button type="submit">{common("create")}</button>
            </form>
          </div>

          <div className="card">
            <h3>{tCompanies("workers")}</h3>
            {workers.length > 0 && (
              <table>
                <tbody>
                  {workers.map((w) => (
                    <tr key={w.id}>
                      <td>{w.name}</td>
                      <td className="muted">{w.tradeRole ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form action={addMyWorkerAction} className="inline mt">
              <input type="hidden" name="companyId" value={company.id} />
              <div>
                <label htmlFor="worker-name">{tCompanies("workerName")}</label>
                <input id="worker-name" name="name" required />
              </div>
              <div>
                <label htmlFor="worker-role">{tCompanies("tradeRole")}</label>
                <input id="worker-role" name="tradeRole" placeholder="welder" />
              </div>
              <button type="submit">{tCompanies("addWorker")}</button>
            </form>
          </div>
        </>
      )}

      <SetPasswordForm />
    </div>
  );
}

async function BuyerRequests({
  locale,
  userId,
}: {
  locale: string;
  userId: string;
}) {
  const t = await getTranslations("portal");
  const tStatus = await getTranslations("rfqStatus");
  const myRfqs = await listRfqsForBuyer(userId);
  if (myRfqs.length === 0) return null;
  return (
    <div className="card">
      <h3>{t("myRequestsTitle")}</h3>
      <table>
        <tbody>
          {myRfqs.map((rfq) => (
            <tr key={rfq.id}>
              <td>
                <Link href={`/${locale}/portal/rfq/${rfq.id}`}>{rfq.title}</Link>
              </td>
              <td>
                <span className={`badge ${rfq.status === "accepted" ? "approved" : rfq.status === "offers_in" ? "in_review" : ""}`}>
                  {tStatus(rfq.status)}
                </span>
              </td>
              <td className="muted">
                {new Date(rfq.createdAt).toISOString().slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function SupplierDispatches({
  locale,
  companyId,
}: {
  locale: string;
  companyId: string;
}) {
  const t = await getTranslations("portal");
  const tStatus = await getTranslations("rfqStatus");
  const dispatches = await listDispatchesForCompany(companyId);
  if (dispatches.length === 0) return null;
  return (
    <div className="card mt">
      <h3>{t("dispatchedTitle")}</h3>
      <p className="muted" style={{ fontSize: "0.85rem" }}>{t("dispatchedHint")}</p>
      <table>
        <tbody>
          {dispatches.map(({ dispatch, rfq }) => (
            <tr key={dispatch.id}>
              <td>
                <Link href={`/${locale}/portal/rfq/${rfq.id}`}>{rfq.title}</Link>
              </td>
              <td>
                <span className={`badge ${rfq.status === "accepted" ? "approved" : "in_review"}`}>
                  {tStatus(rfq.status)}
                </span>
              </td>
              <td className="muted">
                {new Date(dispatch.createdAt).toISOString().slice(0, 10)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
