import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies } from "@/modules/companies/schema";
import { listCasesByState } from "@/modules/verification/service";

export const dynamic = "force-dynamic";

export default async function VerificationKanban({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verification");
  const tState = await getTranslations("caseState");

  const grouped = await listCasesByState();
  const companyIds = Object.values(grouped)
    .flat()
    .map((c) => c.companyId);
  const companyRows = companyIds.length
    ? await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(inArray(companies.id, companyIds))
    : [];
  const nameById = new Map(companyRows.map((c) => [c.id, c.name]));

  return (
    <div>
      <h1>{t("kanbanTitle")}</h1>
      <div className="kanban mt">
        {(Object.keys(grouped) as (keyof typeof grouped)[]).map((state) => (
          <div key={state} className="column">
            <h3>
              {tState(state)} ({grouped[state].length})
            </h3>
            {grouped[state].map((kase) => (
              <Link
                key={kase.id}
                href={`/${locale}/admin/verification/${kase.id}`}
                className="item"
                style={{ display: "block" }}
              >
                <strong>{nameById.get(kase.companyId) ?? kase.companyId.slice(0, 8)}</strong>
                <div className="muted" style={{ fontSize: "0.75rem" }}>
                  {new Date(kase.stateChangedAt).toISOString().slice(0, 10)}
                </div>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
