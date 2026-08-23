import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import SiteChrome from "@/app/[locale]/site-chrome";
import { TradeIcon } from "@/components/trade-icon";
import { Glyph } from "@/components/brand/symbols";
import { localizedName } from "@/modules/catalog/i18n";
import { listTradesForDisplay } from "@/modules/catalog/service";
import { localeAlternates } from "@/lib/seo";

/**
 * Prerendered, not per-request.
 *
 * This page was `force-dynamic` with nothing to justify it: nothing
 * user-specific renders here, and the only data is `listTrades()` —
 * seed data that changes when someone edits a seed file. So every visit
 * hit the database, and when the database was unreachable the most
 * visited page in the product returned 500 instead of the content it
 * had already rendered a thousand times.
 *
 * Prerendering bakes it into the image, so a cold pod serves it even
 * with the database down; the revalidate window picks up a new trade
 * within the hour without a deploy.
 *
 * Which moves the problem rather than solving it, and CI said so: the
 * build itself then needed a database, and neither the CI runner nor
 * `docker build` has one. A build that requires infrastructure is a
 * worse property than the one being fixed. Hence
 * `listTradesForDisplay()` — the table when it is reachable, the seed
 * the table was filled from when it is not.
 */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  // No title override: the home page inherits the localised site title
  // from the layout. The tagline is a slogan — "Rätt kompetens. Rätt
  // pris. Rätt kvalitet." tells a search result nothing about what the
  // site is, and the home page is the one page whose title has to.
  return {
    description: t("description"),
    alternates: localeAlternates(locale),
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const tSup = await getTranslations("suppliers");
  const trades = await listTradesForDisplay();

  return (
    <SiteChrome locale={locale}>
      <div className="search-hero">
        <h1>{t("tagline")}</h1>
        <p>{t("description")}</p>
        <form
          className="search-bar"
          method="get"
          action={`/${locale}/suppliers`}
        >
          <input
            name="q"
            placeholder={tSup("searchPlaceholder")}
            aria-label={tSup("searchLabel")}
          />
          <button type="submit">{tSup("searchCta")}</button>
        </form>
      </div>

      <div className="main" style={{ margin: "0 auto" }}>
        <h2 className="section-title">{t("categoriesTitle")}</h2>
        <div className="cat-grid">
          {trades.map((trade) => (
            <Link
              key={trade.id}
              className="cat-tile"
              href={`/${locale}/suppliers?q=${encodeURIComponent(trade.nameEn)}`}
            >
              <span className="icon">
                <TradeIcon slug={trade.slug} />
              </span>
              <span className="label">{localizedName(trade, locale)}</span>
            </Link>
          ))}
        </div>

        <div className="trust-strip"><Glyph name="verifierad" /> {t("trustLine")}</div>

        <h2 className="section-title">{t("howTitle")}</h2>
        <div className="steps">
          <div className="step">
            <span className="num"><Glyph name="verifierad" /></span>
            <h3>{t("how1t")}</h3>
            <p>{t("how1d")}</p>
          </div>
          <div className="step">
            <span className="num"><Glyph name="arbetslag" /></span>
            <h3>{t("how2t")}</h3>
            <p>{t("how2d")}</p>
          </div>
          <div className="step">
            <span className="num"><Glyph name="utbyte" /></span>
            <h3>{t("how3t")}</h3>
            <p>{t("how3d")}</p>
          </div>
        </div>

        <p
          className="mt"
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
        >
          <Link className="button" href={`/${locale}/request-work`}>
            {t("requestWorkCta")}
          </Link>
          <Link
            className="button"
            href={`/${locale}/register`}
            style={{ background: "var(--surface)", color: "var(--primary)" }}
          >
            {t("joinAsSupplier")}
          </Link>
        </p>
      </div>
    </SiteChrome>
  );
}
