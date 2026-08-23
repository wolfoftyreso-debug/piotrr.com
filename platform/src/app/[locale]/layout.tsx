import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { brand } from "@/lib/brand";
import { SymbolSprite } from "@/components/brand/symbols";
import "../globals.css";
import type { ReactNode } from "react";

const BASE_URL = process.env.PUBLIC_BASE_URL ?? brand.url;

/**
 * Site-wide metadata, per locale.
 *
 * This used to be a static English object claiming "Lithuania to
 * Sweden" — one corridor, when the platform serves twelve — on a site
 * that ships eight languages and hreflang tags to match. Pages that
 * define their own metadata were fine; the five that do not (sign-in,
 * register, the RFQ receipt, the short-link hop) inherited a wrong fact
 * in the wrong language. The open-graph defaults live here too, so a
 * link shared from any page has a title, a description and a locale
 * rather than whatever the scraper guesses.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t("siteTitle");
  const description = t("siteDescription");

  return {
    metadataBase: new URL(BASE_URL),
    title: { default: title, template: `%s | ${brand.name}` },
    description,
    openGraph: {
      type: "website",
      siteName: brand.name,
      locale,
      url: `${BASE_URL}/${locale}`,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <SymbolSprite />
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
