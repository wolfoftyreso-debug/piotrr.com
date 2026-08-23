import { localizedName } from "@/modules/catalog/i18n";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import {
  listCompanyCapacity,
  listPortfolio,
  listReferences,
  resolveCompanySlug,
} from "@/modules/companies/service";
import { presignGet } from "@/modules/documents/service";
import { listTrades } from "@/modules/catalog/service";
import {
  getVerifiedFactsForCompany,
  verifiedDestinations,
} from "@/modules/verification/service";
import { getCompanyByOwner } from "@/modules/companies/service";
import { currentActor } from "@/lib/auth";
import { countryName, countryNames } from "@/lib/countries";
import { routing } from "@/i18n/routing";
import SiteChrome from "@/app/[locale]/site-chrome";
import Link from "next/link";
import { requestClaimAction } from "./claim-actions";
import { jsonLdScript } from "@/lib/jsonld";
import { buildCompanyJsonLd } from "@/lib/company-jsonld";
import { brand } from "@/lib/brand";
import { Glyph } from "@/components/brand/symbols";
import { safeHttpUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

const BASE_URL = process.env.PUBLIC_BASE_URL ?? brand.url;

/** Endonyms so a destination reads the same in every UI language. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const resolved = await resolveCompanySlug(slug);
  if (!resolved) return {};
  const { company, primarySlug } = resolved;

  const languages = Object.fromEntries(
    routing.locales.map((l) => [l, `${BASE_URL}/${l}/company/${primarySlug}`]),
  );

  return {
    title: `${company.name} — ${brand.name}`,
    description:
      company.description?.slice(0, 160) ??
      `${company.name} on ${brand.name} — the verified cross-border subcontracting marketplace.`,
    alternates: {
      canonical: `${BASE_URL}/${locale}/company/${primarySlug}`,
      languages,
    },
    openGraph: {
      title: company.name,
      description: company.description?.slice(0, 200) ?? undefined,
      type: "profile",
    },
  };
}

/** Public verified company profile at a permanent URL (M2) */
export default async function PublicCompanyPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const resolved = await resolveCompanySlug(slug);
  if (!resolved) notFound();
  // Renamed companies keep old URLs working via permanent redirects
  if (!resolved.isPrimary) {
    permanentRedirect(`/${locale}/company/${resolved.primarySlug}`);
  }
  const { company } = resolved;

  // Supplier-controlled (website) and import-controlled (sourceUrl) links are
  // rendered as <a href>; only allow http(s) so a javascript:/data: scheme
  // can never become a clickable link on this public page.
  const safeWebsite = safeHttpUrl(company.website);
  const safeSourceUrl = safeHttpUrl(company.sourceUrl);

  const t = await getTranslations("publicProfile");
  // Corridor comes from the company's own case — a Polish supplier is
  // verified on pl-se, a Latvian one on lv-se. Assuming lt-se here made
  // genuinely verified suppliers render as unverified.
  const verifiedFacts = await getVerifiedFactsForCompany(
    company.id,
    company.country,
  );
  // A badge must say WHERE it is valid: verified for Sweden is not
  // verified for Germany. Empty when the company has no verified corridor.
  const destinations = await verifiedDestinations(company.id);

  const [capacity, trades, approvedPortfolio, references] = await Promise.all([
    listCompanyCapacity(company.id, true),
    listTrades(),
    listPortfolio(company.id, { onlyApproved: true }),
    listReferences(company.id),
  ]);
  // Signed URLs ≤ 15 min (Section 4.7); generated per request, best effort
  const portfolioImages = await Promise.all(
    approvedPortfolio.map(async (item) => ({
      ...item,
      url: await presignGet(item.objectKey).catch(() => null),
    })),
  );

  // Claim eligibility: signed-in supplier without a company of their own
  const actor = await currentActor();
  const canClaim =
    company.claimStatus === "unclaimed" &&
    actor?.role === "supplier" &&
    !(await getCompanyByOwner(actor.userId));
  const tradeById = new Map(trades.map((tr) => [tr.id, tr]));

  // No vatID here by construction — see buildCompanyJsonLd: VAT is internal
  // CRM and must not leak through the JSON-LD served to crawlers.
  const jsonLd = buildCompanyJsonLd(
    company,
    `${BASE_URL}/${locale}/company/${slug}`,
  );

  return (
    <SiteChrome locale={locale}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <div className="main" style={{ margin: "0 auto" }}>
        <h1>{company.name}</h1>
        <p className="muted">
          {company.city ? `${company.city}, ` : ""}
          {company.country}
          {company.yearFounded ? ` · ${t("founded")} ${company.yearFounded}` : ""}
          {company.headcount ? ` · ${company.headcount} ${t("employees")}` : ""}
          {company.languages.length > 0
            ? ` · ${t("languages")}: ${company.languages.join(", ").toUpperCase()}`
            : ""}
        </p>

        {/* Unclaimed catalog profile: provenance + takeover via verification */}
        {company.claimStatus === "unclaimed" && (
          <div className="card" style={{ borderColor: "var(--warning)" }}>
            <h3 style={{ marginTop: 0 }}>
              <span className="badge in_review">{t("unclaimedBadge")}</span>
            </h3>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              {t("unclaimedBody")}
              {safeSourceUrl && (
                <>
                  {" "}
                  {t("sourceLabel")}:{" "}
                  <a href={safeSourceUrl} rel="nofollow noopener noreferrer" target="_blank">
                    {company.sourceName ?? safeSourceUrl}
                  </a>
                  .
                </>
              )}
            </p>
            {canClaim ? (
              <form action={requestClaimAction}>
                <input type="hidden" name="companyId" value={company.id} />
                <button type="submit" className="button" style={{ font: "inherit", fontWeight: 600, cursor: "pointer" }}>
                  {t("claimCta")}
                </button>
              </form>
            ) : (
              <Link className="button" href={`/${locale}/register`}>
                {t("claimRegisterCta")}
              </Link>
            )}
          </div>
        )}

        {company.description && (
          <div className="card">
            <p style={{ margin: 0, whiteSpace: "pre-line" }}>{company.description}</p>
            {(company.category || safeWebsite) && (
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
                {company.category}
                {safeWebsite && (
                  <>
                    {company.category ? " · " : ""}
                    <a href={safeWebsite} rel="nofollow noopener noreferrer" target="_blank">
                      {safeWebsite.replace(/^https?:\/\//, "")}
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {/* Service areas + self-reported certifications (kept clearly apart
            from the platform-VERIFIED facts panel below) */}
        {(company.serviceAreas.length > 0 ||
          company.certifications.length > 0 ||
          company.awards.length > 0) && (
          <div className="card">
            {company.serviceAreas.length > 0 && (
              <p style={{ margin: 0 }}>
                <strong>{t("serviceAreas")}:</strong>{" "}
                {company.serviceAreas.join(" · ")}
              </p>
            )}
            {company.certifications.length > 0 && (
              <p className="muted" style={{ margin: company.serviceAreas.length ? "0.5rem 0 0" : 0, fontSize: "0.9rem" }}>
                <strong>{t("selfReportedCerts")}:</strong>{" "}
                {company.certifications.join(" · ")}{" "}
                <span style={{ fontSize: "0.8rem" }}>({t("selfReportedNote")})</span>
              </p>
            )}
            {company.awards.length > 0 && (
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
                <strong>{t("statedAwards")}:</strong>{" "}
                {company.awards.join(" · ")}{" "}
                <span style={{ fontSize: "0.8rem" }}>({t("selfReportedNote")})</span>
              </p>
            )}
          </div>
        )}

        {/* Verified panel — ONLY platform-verified facts, binary badge */}
        <div className="card" style={verifiedFacts.verified ? { borderColor: "var(--success)" } : undefined}>
          <h2 style={{ marginTop: 0 }}>
            {verifiedFacts.verified ? (
              <span className="badge verified" style={{ fontSize: "0.95rem" }}>
                <Glyph name="verifierad" /> {t("verifiedBadgeFor", {
                  country: destinations.length
                    ? countryNames(destinations, locale)
                    : countryName(company.country, locale),
                })}
              </span>
            ) : (
              <span className="badge">{t("notVerified")}</span>
            )}
          </h2>
          {verifiedFacts.verified ? (
            <>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                {t("verifiedExplainer")}
                {verifiedFacts.verifiedSince && (
                  <>
                    {" "}
                    {t("verifiedSince")}{" "}
                    {new Date(verifiedFacts.verifiedSince).toISOString().slice(0, 10)}.
                  </>
                )}
              </p>
              <table>
                <tbody>
                  {company.registrationNumber && (
                    <tr>
                      <td>{t("orgNumber")}</td>
                      <td><strong>{company.registrationNumber}</strong> ✓</td>
                    </tr>
                  )}
                  {verifiedFacts.facts.map((fact) => (
                    <tr key={fact.key}>
                      <td>{localizedName(fact, locale)}</td>
                      <td>
                        <strong>✓</strong>
                        {fact.workerCount ? ` × ${fact.workerCount}` : ""}
                        {typeof fact.metadata.approval_date === "string" &&
                          ` · ${fact.metadata.approval_date}`}
                        {typeof fact.metadata.insurer === "string" &&
                          ` · ${fact.metadata.insurer}`}
                        {typeof fact.metadata.status === "string" &&
                          ` · ${fact.metadata.status}`}
                        {fact.validUntil &&
                          ` · ${t("validUntil")} ${new Date(fact.validUntil).toISOString().slice(0, 10)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{t("notVerifiedExplainer")}</p>
          )}
        </div>

        {/* Project images — only ops-approved items are shown */}
        {portfolioImages.length > 0 && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t("portfolioTitle")}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "0.75rem" }}>
              {portfolioImages.map((item) => (
                <figure key={item.id} style={{ margin: 0 }}>
                  {item.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.url}
                      alt={item.title}
                      style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
                    />
                  ) : (
                    <div style={{ height: 150, borderRadius: 8, border: "1px dashed var(--border)", display: "grid", placeItems: "center" }} className="muted">
                      {item.title}
                    </div>
                  )}
                  <figcaption className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                    {item.title}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {/* References — collected and checked by Piotrr ops */}
        {references.length > 0 && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t("referencesTitle")}</h2>
            <p className="muted" style={{ fontSize: "0.85rem" }}>{t("referencesNote")}</p>
            <div className="scroll">
              <table>
                <tbody>
                  {references.map((reference) => (
                    <tr key={reference.id}>
                      <td>
                        <strong>{reference.projectTitle}</strong>
                        {reference.scopeSummary && (
                          <div className="muted" style={{ fontSize: "0.85rem" }}>
                            {reference.scopeSummary}
                          </div>
                        )}
                      </td>
                      <td className="muted">
                        {reference.clientName} · {reference.country}
                        {reference.year ? ` · ${reference.year}` : ""}
                      </td>
                      <td className="muted" style={{ fontSize: "0.8rem" }}>
                        {t("referenceContact")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Capacity listings */}
        {capacity.length > 0 && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>{t("capacityTitle")}</h2>
            <table>
              <tbody>
                {capacity.map((listing) => {
                  const trade = tradeById.get(listing.tradeId);
                  return (
                    <tr key={listing.id}>
                      <td>
                        <strong>
                          {trade ? localizedName(trade, locale) : "—"}
                        </strong>
                        {listing.certificationsSummary && (
                          <div className="muted" style={{ fontSize: "0.8rem" }}>
                            {listing.certificationsSummary}
                          </div>
                        )}
                      </td>
                      <td>{listing.headcount} {t("workers")}</td>
                      <td className="muted">
                        {listing.earliestStart
                          ? `${t("earliestStart")}: ${new Date(listing.earliestStart).toISOString().slice(0, 10)}`
                          : ""}
                        {listing.weeksAvailable
                          ? ` · ${listing.weeksAvailable} ${t("weeks")}`
                          : ""}
                        {listing.baseLocation ? ` · ${listing.baseLocation}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="card" style={{ background: "var(--primary)", color: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>{t("ctaTitle")}</h3>
          <p style={{ opacity: 0.9 }}>{t("ctaBody")}</p>
          <a
            className="button"
            style={{ background: "#fff", color: "var(--primary)" }}
            href={`mailto:ops@piotrr.example?subject=${encodeURIComponent(
              `Work request via ${brand.name}: ${company.name}`,
            )}`}
          >
            {t("ctaButton")}
          </a>
        </div>
      </div>
    </SiteChrome>
  );
}
