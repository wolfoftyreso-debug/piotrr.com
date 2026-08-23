import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentActor } from "@/lib/auth";
import { requireAnyRole } from "@/modules/identity/rbac";
import { formatMinor } from "@/lib/money";
import { listDeals } from "@/modules/offers/service";
import { listRfqsByIds } from "@/modules/rfq/service";
import { getCompany } from "@/modules/companies/service";

export const dynamic = "force-dynamic";

/** Deals recorded on acceptance — export feeds manual invoicing (M3 DoD) */
export default async function AdminDeals({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("deals");
  const actor = requireAnyRole(await currentActor(), ["ops", "admin"]);

  const rows = await listDeals(actor);
  const rfqs = await listRfqsByIds(rows.map((d) => d.rfqId));
  const rfqById = new Map(rfqs.map((r) => [r.id, r]));
  const companyNames = new Map<string, string>();
  for (const deal of rows) {
    if (!companyNames.has(deal.companyId)) {
      const company = await getCompany(deal.companyId);
      companyNames.set(deal.companyId, company?.name ?? "—");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1>{t("title")}</h1>
        {/* Plain anchor on purpose: this is a CSV file download, not navigation */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="button" href="/api/v1/deals/export">
          {t("exportCsv")}
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="muted mt">{t("empty")}</p>
      ) : (
        <table className="mt">
          <thead>
            <tr>
              <th>{t("rfq")}</th>
              <th>{t("supplier")}</th>
              <th>{t("contractValue")}</th>
              <th>{t("fee")}</th>
              <th>{t("recorded")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((deal) => {
              const fee = Math.round(
                (deal.contractValueMinor * Number(deal.successFeePct)) / 100,
              );
              return (
                <tr key={deal.id}>
                  <td>{rfqById.get(deal.rfqId)?.title ?? deal.rfqId.slice(0, 8)}</td>
                  <td>{companyNames.get(deal.companyId)}</td>
                  <td>{formatMinor(deal.contractValueMinor, deal.currency)}</td>
                  <td>
                    {formatMinor(fee, deal.currency)}{" "}
                    <span className="muted">({deal.successFeePct}%)</span>
                  </td>
                  <td className="muted">
                    {new Date(deal.createdAt).toISOString().slice(0, 10)}
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
