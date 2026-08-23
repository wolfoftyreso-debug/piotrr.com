import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { searchSuppliers } from "@/modules/search/service";
import { countryNames } from "@/lib/countries";
import { listTrades } from "@/modules/catalog/service";
import { CountryFlag } from "@/components/country-flag";
import { Glyph } from "@/components/brand/symbols";
import { localizedName } from "@/modules/catalog/i18n";
import SiteChrome from "@/app/[locale]/site-chrome";
import { localeAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "suppliers" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: localeAlternates(locale, "/suppliers"),
  };
}

/** Public supplier directory — Postgres FTS + trigram, verified first */
export default async function Suppliers({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; country?: string; verified?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("suppliers");
  const query = await searchParams;

  const [hits, trades] = await Promise.all([
    searchSuppliers({
      q: query.q,
      country: query.country || undefined,
      verifiedOnly: query.verified === "1",
    }),
    listTrades(),
  ]);

  return (
    <SiteChrome locale={locale}>
      <div className="main" style={{ margin: "0 auto" }}>
        <h1>{t("title")}</h1>
        <p className="muted">{t("subtitle")}</p>

        <form method="get" className="search-bar mt" style={{ maxWidth: "none", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
          <input
            id="q"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
          />
          <select
            id="country"
            name="country"
            defaultValue={query.country ?? ""}
            style={{ border: "none", background: "transparent" }}
          >
            <option value="">{t("anyCountry")}</option>
            <option value="LT">Lietuva</option>
            <option value="LV">Latvija</option>
            <option value="EE">Eesti</option>
            <option value="PL">Polska</option>
          </select>
          <label
            htmlFor="verified"
            style={{ display: "flex", alignItems: "center", gap: "0.35rem", margin: 0, whiteSpace: "nowrap", fontSize: "0.85rem" }}
          >
            <input
              type="checkbox"
              id="verified"
              name="verified"
              value="1"
              defaultChecked={query.verified === "1"}
            />
            {t("verifiedOnly")}
          </label>
          <button type="submit">{t("searchCta")}</button>
        </form>

        <div className="chip-row">
          {trades.map((trade) => {
            const active = (query.q ?? "") === trade.nameEn;
            return (
              <Link
                key={trade.id}
                className={`chip${active ? " active" : ""}`}
                href={`/${locale}/suppliers?q=${encodeURIComponent(trade.nameEn)}`}
              >
                {localizedName(trade, locale)}
              </Link>
            );
          })}
        </div>

        {hits.length === 0 ? (
          <p className="muted mt">{t("empty")}</p>
        ) : (
          <div className="mt">
            {hits.map((hit) => {
              const inner = (
                <div className="listing" key={hit.companyId}>
                  <div className="thumb" aria-hidden>
                    <CountryFlag code={hit.country} size={46} />
                  </div>
                  <div className="body">
                    <h3>{hit.name}</h3>
                    <div className="meta">
                      {hit.country}
                      {hit.city ? ` · ${hit.city}` : ""}
                      {hit.category ? ` · ${hit.category}` : ""}
                      {hit.yearFounded ? ` · ${t("since")} ${hit.yearFounded}` : ""}
                      {hit.headcount ? ` · ${hit.headcount} ${t("employees")}` : ""}
                    </div>
                    {hit.description && <p className="desc">{hit.description}</p>}
                  </div>
                  <div className="side">
                    {hit.verified ? (
                      <span className="badge verified">
                        <Glyph name="verifierad" /> {t("verifiedDestinations")}{" "}
                        {countryNames(hit.verifiedDestinations, locale)}
                      </span>
                    ) : (
                      <span className="badge">{t("notVerified")}</span>
                    )}
                    {hit.unclaimed && (
                      <span className="badge in_review">{t("unclaimedBadge")}</span>
                    )}
                  </div>
                </div>
              );
              return hit.slug ? (
                <Link
                  key={hit.companyId}
                  href={`/${locale}/company/${hit.slug}`}
                  style={{ color: "inherit", display: "block" }}
                >
                  {inner}
                </Link>
              ) : (
                inner
              );
            })}
          </div>
        )}
      </div>
    </SiteChrome>
  );
}
