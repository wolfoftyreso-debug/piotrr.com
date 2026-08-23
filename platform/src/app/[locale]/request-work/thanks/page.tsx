import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import SiteChrome from "@/app/[locale]/site-chrome";

export default async function RequestWorkThanks({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("requestWork");

  return (
    <SiteChrome locale={locale}>
      <div className="main" style={{ margin: "0 auto", maxWidth: 640, textAlign: "center" }}>
        <h1>✓ {t("thanksTitle")}</h1>
        <p className="muted">{t("thanksBody")}</p>
        <p className="mt">
          <Link className="button" href={`/${locale}/portal`}>
            {t("thanksCta")}
          </Link>
        </p>
      </div>
    </SiteChrome>
  );
}
