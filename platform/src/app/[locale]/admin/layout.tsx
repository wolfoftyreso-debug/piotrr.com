import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentActor, currentUser, signOut } from "@/lib/auth";
import { hasRole } from "@/modules/identity/rbac";
import type { ReactNode } from "react";
import { PiotrrWordmark } from "@/components/brand/PiotrrWordmark";
import { Glyph } from "@/components/brand/symbols";
import { OpsNav } from "./OpsNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const actor = await currentActor();
  if (!actor) redirect(`/${locale}/signin`);
  if (!hasRole(actor, "ops")) redirect(`/${locale}`);

  const user = await currentUser();
  const t = await getTranslations("nav");
  const common = await getTranslations("common");

  const labels = {
    dashboard: t("dashboard"),
    verification: t("verification"),
    reviewQueue: t("reviewQueue"),
    companies: t("companies"),
    rfqs: t("rfqs"),
    deals: t("deals"),
    tasks: t("tasks"),
    staff: t("staff"),
    groupVerification: t("groupVerification"),
    groupTrade: t("groupTrade"),
    groupSystem: t("groupSystem"),
  };

  const email = user?.email ?? "";
  const initial = (email.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="ops">
      <aside className="ops-side">
        <Link className="ops-brand" href={`/${locale}/admin`}>
          <PiotrrWordmark variant="inverse" style={{ fontSize: "1.05rem" }} />
          <span className="ops-brand-tag">ops</span>
        </Link>

        <OpsNav locale={locale} labels={labels} />

        <div className="ops-foot">
          <div className="ops-account">
            <span className="ops-avatar" aria-hidden>
              {initial}
            </span>
            <span className="ops-account-mail" title={email}>
              {email}
            </span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut();
              redirect(`/${locale}`);
            }}
          >
            <button className="ops-signout" type="submit">
              <Glyph name="stang" />
              <span>{common("signOut")}</span>
            </button>
          </form>
        </div>
      </aside>

      <main className="ops-main">{children}</main>
    </div>
  );
}
