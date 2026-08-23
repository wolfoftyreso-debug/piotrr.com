import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { routing } from "@/i18n/routing";
import { brand } from "@/lib/brand";
import { PiotrrWordmark } from "@/components/brand/PiotrrWordmark";

const LOCALE_LABELS: Record<string, string> = {
  sv: "Svenska",
  en: "English",
  lt: "Lietuvių",
  lv: "Latviešu",
  et: "Eesti",
  pl: "Polski",
  de: "Deutsch",
  da: "Dansk",
};

/** Public site header/footer (marketing + directory pages) */
export default async function SiteChrome({
  locale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const t = await getTranslations("chrome");
  const common = await getTranslations("common");

  return (
    <div>
      {/* The corridors we cover, stated before anything else — it is the
          one fact that decides whether a visitor is on the right site at
          all, and it keeps the country list out of the logo, where it
          used to crowd the wordmark off the edge of a phone. */}
      <div className="corridorbar">
        <div className="main corridorbar-inner">
          <span className="corridorbar-route">
            <span className="corridorbar-end">LT · PL · LV · EE</span>
            <span className="corridorbar-arrow" aria-hidden="true">
              →
            </span>
            <span className="corridorbar-end">SE · DE · DK</span>
          </span>
          <span className="corridorbar-note">{t("corridorNote")}</span>
        </div>
      </div>

      <header className="site-header">
        <div className="main site-masthead">
          {/* Wordmark, no icon — a decision, not an omission. Three
              drawn marks were rendered against this lockup at the size
              the header actually uses: an arch in a block and the same
              arch unboxed both read as a lowercase "n", and piers-and-
              span read as "TT". A glyph that needs explaining is worse
              than no glyph. The corridor strip above carries the
              graphic weight instead. */}
          <Link className="brandmark" href={`/${locale}`}>
            <PiotrrWordmark style={{ fontSize: "1.3rem" }} />
            <span>{t("tagline")}</span>
          </Link>
          <nav className="site-nav" aria-label={t("mainMenu")}>
            <Link className="site-nav-link" href={`/${locale}/suppliers`}>
              {t("findSuppliers")}
            </Link>
            <Link className="site-nav-link" href={`/${locale}/request-work`}>
              {t("requestWork")}
            </Link>
            <Link className="site-nav-link" href={`/${locale}/register`}>
              {t("join")}
            </Link>
            <Link className="site-nav-cta" href={`/${locale}/signin`}>
              {common("signIn")}
            </Link>
          </nav>
        </div>
        {/* Phone: one scrollable line instead of a wrapped block. Ragged
            second rows were what made the old header look broken. */}
        <nav className="site-navstrip" aria-label={t("mainMenu")}>
          <Link href={`/${locale}/suppliers`}>{t("findSuppliers")}</Link>
          <Link href={`/${locale}/request-work`}>{t("requestWork")}</Link>
          <Link href={`/${locale}/register`}>{t("join")}</Link>
        </nav>
      </header>
      {children}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          marginTop: "3rem",
          padding: "1.5rem 0",
          textAlign: "center",
        }}
        className="muted"
      >
        <div style={{ marginBottom: "0.5rem" }}>
          <Link href={`/${locale}/markets/sweden`}>{t("marketSweden")}</Link>
          {" · "}
          <Link href={`/${locale}/markets/germany`}>{t("marketGermany")}</Link>
          {" · "}
          <Link href={`/${locale}/markets/denmark`}>{t("marketDenmark")}</Link>
          {" · "}
          <Link href={`/${locale}/markets/norway`}>{t("marketNorway")}</Link>
        </div>
        <div style={{ marginBottom: "0.5rem", fontSize: "0.85rem" }}>
          {routing.locales.map((l, i) => (
            <span key={l}>
              {i > 0 && " · "}
              {l === locale ? (
                <strong>{LOCALE_LABELS[l] ?? l}</strong>
              ) : (
                <Link href={`/${l}`} lang={l} hrefLang={l}>
                  {LOCALE_LABELS[l] ?? l}
                </Link>
              )}
            </span>
          ))}
        </div>
        {brand.name} — {t("footerLine")}
      </footer>
    </div>
  );
}
