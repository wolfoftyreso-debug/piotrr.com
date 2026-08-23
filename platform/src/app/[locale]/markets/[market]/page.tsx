import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import SiteChrome from "@/app/[locale]/site-chrome";
import { jsonLdScript } from "@/lib/jsonld";
import { brand } from "@/lib/brand";

export const dynamic = "force-dynamic";

const BASE_URL = process.env.PUBLIC_BASE_URL ?? brand.url;

/** Target markets. `live` means a corridor with its own requirement
 * catalogue exists for that destination (corridors are seed data —
 * Section 2); Norway has no corridor yet, so its page captures demand
 * ahead of launch. */
const MARKETS = ["sweden", "germany", "denmark", "norway"] as const;
type Market = (typeof MARKETS)[number];

const MARKET_META: Record<Market, { country: string; live: boolean }> = {
  sweden: { country: "SE", live: true },
  germany: { country: "DE", live: true },
  denmark: { country: "DK", live: true },
  norway: { country: "NO", live: false },
};

export function generateStaticParams() {
  return routing.locales.flatMap((locale) =>
    MARKETS.map((market) => ({ locale, market })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; market: string }>;
}): Promise<Metadata> {
  const { locale, market } = await params;
  if (!MARKETS.includes(market as Market)) return {};
  const t = await getTranslations({ locale, namespace: `markets.${market}` });

  const languages = Object.fromEntries(
    routing.locales.map((l) => [l, `${BASE_URL}/${l}/markets/${market}`]),
  );

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: `${BASE_URL}/${locale}/markets/${market}`,
      languages,
    },
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      type: "website",
    },
  };
}

export default async function MarketPage({
  params,
}: {
  params: Promise<{ locale: string; market: string }>;
}) {
  const { locale, market } = await params;
  if (!MARKETS.includes(market as Market)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations(`markets.${market}`);
  const shared = await getTranslations("markets.shared");
  const meta = MARKET_META[market as Market];

  const faq = [1, 2, 3, 4].map((i) => ({
    q: t(`faq${i}q`),
    a: t(`faq${i}a`),
  }));

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: t("metaTitle"),
      provider: { "@type": "Organization", name: brand.name },
      areaServed: meta.country,
      serviceType: "Verified cross-border industrial subcontracting",
      description: t("metaDescription"),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];

  return (
    <SiteChrome locale={locale}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <div className="main" style={{ margin: "0 auto", maxWidth: 860 }}>
        <h1>{t("h1")}</h1>
        <p className="muted" style={{ fontSize: "1.05rem" }}>{t("intro")}</p>

        {!meta.live && (
          <p>
            <span className="badge in_review">{shared("openingSoon")}</span>{" "}
            <span className="muted">{shared("openingSoonBody")}</span>
          </p>
        )}

        {/* The cost argument */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{shared("costTitle")}</h2>
          <p style={{ margin: 0 }}>{t("costBody")}</p>
        </div>

        {/* The compliance argument — the moat */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t("complianceTitle")}</h2>
          <p>{t("complianceIntro")}</p>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <li key={i}>{t(`compliance${i}`)}</li>
            ))}
          </ul>
        </div>

        {/* How it works */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{shared("howTitle")}</h2>
          <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
            <li>{shared("how1")}</li>
            <li>{shared("how2")}</li>
            <li>{shared("how3")}</li>
            <li>{shared("how4")}</li>
          </ol>
        </div>

        {/* FAQ */}
        <h2>{shared("faqTitle")}</h2>
        {faq.map((item) => (
          <div key={item.q} className="card">
            <h3 style={{ marginTop: 0 }}>{item.q}</h3>
            <p style={{ margin: 0 }} className="muted">{item.a}</p>
          </div>
        ))}

        <div className="card" style={{ background: "var(--primary)", color: "#fff", textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>{shared("ctaTitle")}</h2>
          <p style={{ opacity: 0.9 }}>{shared("ctaBody")}</p>
          <p style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap", margin: 0 }}>
            <Link className="button" style={{ background: "#fff", color: "var(--primary)" }} href={`/${locale}/request-work`}>
              {shared("ctaRequest")}
            </Link>
            <Link className="button" style={{ background: "transparent", border: "1px solid #fff" }} href={`/${locale}/suppliers`}>
              {shared("ctaBrowse")}
            </Link>
          </p>
        </div>
      </div>
    </SiteChrome>
  );
}
