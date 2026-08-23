import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import RedeemLink from "./redeem";

export const dynamic = "force-dynamic";

/**
 * Landing page for an emailed sign-in link. Redemption happens client-side
 * because Auth.js must set the session cookie from the browser.
 */
export default async function MagicLinkLanding({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token, email } = await searchParams;
  const t = await getTranslations("auth");

  if (!token || !email) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h1>{t("linkInvalidTitle")}</h1>
          <p className="muted">{t("linkInvalidBody")}</p>
          <Link className="button" href={`/${locale}/signin`}>
            {t("title")}
          </Link>
        </div>
      </div>
    );
  }

  return <RedeemLink locale={locale} email={email} token={token} />;
}
