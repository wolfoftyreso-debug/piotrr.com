import { localizedName } from "@/modules/catalog/i18n";
import { StatusBadge } from "@/components/brand/StatusBadge";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { requirementDefinitions } from "@/modules/catalog/schema";
import { companies } from "@/modules/companies/schema";
import {
  verificationCases,
  verificationItems,
} from "@/modules/verification/schema";

export const dynamic = "force-dynamic";

/** Document review queue: everything submitted or in review, oldest first */
export default async function ReviewQueue({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verification");
  const tItem = await getTranslations("itemStatus");

  const items = await db
    .select()
    .from(verificationItems)
    .where(inArray(verificationItems.status, ["submitted", "in_review"]))
    .orderBy(verificationItems.updatedAt);

  const caseIds = [...new Set(items.map((i) => i.caseId))];
  const cases = caseIds.length
    ? await db
        .select()
        .from(verificationCases)
        .where(inArray(verificationCases.id, caseIds))
    : [];
  const caseById = new Map(cases.map((c) => [c.id, c]));

  const companyIds = [...new Set(cases.map((c) => c.companyId))];
  const companyRows = companyIds.length
    ? await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(inArray(companies.id, companyIds))
    : [];
  const companyById = new Map(companyRows.map((c) => [c.id, c.name]));

  const reqIds = [...new Set(items.map((i) => i.requirementDefinitionId))];
  const reqs = reqIds.length
    ? await db
        .select()
        .from(requirementDefinitions)
        .where(inArray(requirementDefinitions.id, reqIds))
    : [];
  const reqById = new Map(reqs.map((r) => [r.id, r]));

  return (
    <div>
      <h1>{t("queueTitle")}</h1>
      {items.length === 0 ? (
        <p className="muted mt">{t("queueEmpty")}</p>
      ) : (
        <table className="mt">
          <thead>
            <tr>
              <th>{t("requirement")}</th>
              <th>Company</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const kase = caseById.get(item.caseId);
              const req = reqById.get(item.requirementDefinitionId);
              return (
                <tr key={item.id}>
                  <td>{req ? localizedName(req, locale) : item.requirementDefinitionId}</td>
                  <td>{kase ? (companyById.get(kase.companyId) ?? "—") : "—"}</td>
                  <td>
                    <StatusBadge status={item.status} label={tItem(item.status)} />
                  </td>
                  <td>
                    <Link href={`/${locale}/admin/verification/${item.caseId}`}>
                      →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
