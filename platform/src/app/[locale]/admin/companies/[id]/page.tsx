import Link from "next/link";
import { StatusBadge } from "@/components/brand/StatusBadge";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { countryName } from "@/lib/countries";
import { listCorridors } from "@/modules/catalog/service";
import {
  getCompany,
  listContacts,
  listPortfolio,
  listReferences,
  listWorkers,
} from "@/modules/companies/service";
import { documents } from "@/modules/documents/schema";
import { verificationCases } from "@/modules/verification/schema";
import { badgeVisible, type CaseState } from "@/modules/verification/domain";
import { safeHttpUrl } from "@/lib/url";
import {
  addContactAction,
  addReferenceAction,
  addWorkerAction,
  assignOwnershipAction,
  moderatePortfolioAction,
  openCaseAction,
} from "@/app/[locale]/admin/actions";

export const dynamic = "force-dynamic";

/** Company 360° view: profile, workers, documents, verification history */
export default async function CompanyDetail({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("companies");
  const tVerification = await getTranslations("verification");
  const tState = await getTranslations("caseState");

  const company = await getCompany(id);
  if (!company) notFound();

  const [workers, contacts, docs, cases, corridors, portfolio, references] =
    await Promise.all([
      listWorkers(id),
      listContacts(id),
      db.select().from(documents).where(and(eq(documents.companyId, id))),
      db.select().from(verificationCases).where(eq(verificationCases.companyId, id)),
      listCorridors(),
      listPortfolio(id, { onlyApproved: false }),
      listReferences(id),
    ]);
  const pendingPortfolio = portfolio.filter((p) => p.status === "pending");

  const kase = cases[0];
  const state = kase?.state as CaseState | undefined;
  // Corridors open to this supplier's home country. The destination is a
  // deliberate choice by ops, never a default: the requirement catalogue,
  // and therefore what the badge legally means, differs per destination.
  const openCorridors = corridors
    .filter((c) => c.fromCountry === company.country)
    .sort((a, b) => a.toCountry.localeCompare(b.toCountry));
  const caseCorridor =
    openCorridors.find((c) => c.toCountry === "SE") ?? openCorridors[0];
  // The badge names the destination of the case that exists, not a guess
  // from the home country — a company can hold several cases.
  const destination = countryName(
    corridors.find((c) => c.id === kase?.corridorId)?.toCountry ?? "",
    locale,
  );

  return (
    <div>
      <h1>{company.name}</h1>
      <p className="muted">
        {company.country}
        {company.city ? ` · ${company.city}` : ""}
        {company.registrationNumber ? ` · ${t("registrationNumber")}: ${company.registrationNumber}` : ""}
        {company.vatNumber ? ` · ${t("vatNumber")}: ${company.vatNumber}` : ""}
      </p>

      {/* Catalog claim handling */}
      {company.claimStatus === "unclaimed" && (
        <div className="card" style={{ borderColor: "var(--warning)" }}>
          <h3>{t("unclaimedTitle")}</h3>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {t("unclaimedHint")}
            {safeHttpUrl(company.sourceUrl) && (
              <>
                {" "}
                <a href={safeHttpUrl(company.sourceUrl)!} rel="noopener noreferrer" target="_blank">
                  {company.sourceName ?? safeHttpUrl(company.sourceUrl)}
                </a>
              </>
            )}
          </p>
          <form action={assignOwnershipAction} className="inline">
            <input type="hidden" name="companyId" value={company.id} />
            <div>
              <label htmlFor="owner-email">{t("ownerEmail")}</label>
              <input id="owner-email" name="ownerEmail" type="email" required />
            </div>
            <button type="submit">{t("assignOwner")}</button>
          </form>
        </div>
      )}

      {/* Verification */}
      <div className="card">
        <h3>{t("verificationCase")}</h3>
        {kase && state ? (
          <p>
            <StatusBadge status={state} label={tState(state)} />{" "}
            {badgeVisible(state) && (
              <span className="badge verified">
                ✓ {tVerification("verifiedBadgeFor", { country: destination })}
              </span>
            )}{" "}
            <Link href={`/${locale}/admin/verification/${kase.id}`}>→</Link>
          </p>
        ) : (
          <div>
            <p className="muted">{t("noCase")}</p>
            <form action={openCaseAction} className="inline">
              <input type="hidden" name="companyId" value={company.id} />
              <div>
                <label htmlFor="corridorId">
                  {tVerification("destination")}
                </label>
                <select
                  id="corridorId"
                  name="corridorId"
                  defaultValue={caseCorridor?.id ?? ""}
                  required
                >
                  {openCorridors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {countryName(c.toCountry, locale)} ({c.slug})
                    </option>
                  ))}
                </select>
              </div>
              {workers.map((w) => (
                <input key={w.id} type="hidden" name="workerIds" value={w.id} />
              ))}
              <button type="submit" disabled={openCorridors.length === 0}>
                {tVerification("openCase")}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Workers */}
      <div className="card">
        <h3>{t("workers")}</h3>
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
        <form action={addWorkerAction} className="inline mt">
          <input type="hidden" name="companyId" value={company.id} />
          <div>
            <label htmlFor="worker-name">{t("workerName")}</label>
            <input id="worker-name" name="name" required />
          </div>
          <div>
            <label htmlFor="worker-role">{t("tradeRole")}</label>
            <input id="worker-role" name="tradeRole" placeholder="welder" />
          </div>
          <button type="submit">{t("addWorker")}</button>
        </form>
      </div>

      {/* Contacts */}
      <div className="card">
        <h3>{t("contacts")}</h3>
        {contacts.length > 0 && (
          <table>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted">{c.email ?? "—"}</td>
                  <td className="muted">{c.phone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addContactAction} className="inline mt">
          <input type="hidden" name="companyId" value={company.id} />
          <div>
            <label htmlFor="contact-name">{t("workerName")}</label>
            <input id="contact-name" name="name" required />
          </div>
          <div>
            <label htmlFor="contact-email">Email</label>
            <input id="contact-email" name="email" type="email" />
          </div>
          <div>
            <label htmlFor="contact-phone">Tel</label>
            <input id="contact-phone" name="phone" />
          </div>
          <button type="submit" className="secondary">+</button>
        </form>
      </div>

      {/* Portfolio moderation */}
      <div className="card">
        <h3>{t("portfolioModTitle")}</h3>
        {pendingPortfolio.length === 0 && portfolio.length === 0 && (
          <p className="muted">—</p>
        )}
        {portfolio.length > 0 && (
          <table>
            <tbody>
              {portfolio.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    {item.description && (
                      <div className="muted" style={{ fontSize: "0.8rem" }}>{item.description}</div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${item.status === "approved" ? "approved" : item.status === "rejected" ? "rejected" : "submitted"}`}>
                      {item.status}
                    </span>
                  </td>
                  <td>
                    {item.status === "pending" && (
                      <div className="flex" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        <form action={moderatePortfolioAction}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="decision" value="approved" />
                          <button type="submit" className="secondary">{t("portfolioApprove")}</button>
                        </form>
                        <form action={moderatePortfolioAction} className="inline">
                          <input type="hidden" name="itemId" value={item.id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <input name="note" placeholder="…" style={{ width: 120 }} />
                          <button type="submit" className="danger">{t("portfolioReject")}</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* References — collected by ops */}
      <div className="card">
        <h3>{t("referencesTitle")}</h3>
        {references.length > 0 && (
          <table>
            <tbody>
              {references.map((reference) => (
                <tr key={reference.id}>
                  <td><strong>{reference.projectTitle}</strong></td>
                  <td className="muted">
                    {reference.clientName} · {reference.country}
                    {reference.year ? ` · ${reference.year}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addReferenceAction} className="inline mt">
          <input type="hidden" name="companyId" value={company.id} />
          <div>
            <label htmlFor="ref-title">{t("refProject")}</label>
            <input id="ref-title" name="projectTitle" required />
          </div>
          <div>
            <label htmlFor="ref-client">{t("refClient")}</label>
            <input id="ref-client" name="clientName" required />
          </div>
          <div>
            <label htmlFor="ref-country">{t("refCountry")}</label>
            <input id="ref-country" name="country" maxLength={2} defaultValue="SE" style={{ width: 60 }} />
          </div>
          <div>
            <label htmlFor="ref-year">{t("refYear")}</label>
            <input id="ref-year" name="year" type="number" min={1990} max={2100} style={{ width: 90 }} />
          </div>
          <div>
            <label htmlFor="ref-scope">{t("refScope")}</label>
            <input id="ref-scope" name="scopeSummary" />
          </div>
          <button type="submit">{t("refAdd")}</button>
        </form>
      </div>

      {/* Documents */}
      <div className="card">
        <h3>{t("documents")}</h3>
        {docs.length === 0 ? (
          <p className="muted">—</p>
        ) : (
          <table>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.fileName}</td>
                  <td className="muted">{d.documentType ?? "—"}</td>
                  <td>
                    <span className={`badge ${d.scanStatus === "clean" ? "approved" : ""}`}>
                      {d.scanStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
