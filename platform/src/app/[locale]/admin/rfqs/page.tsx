import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { listRfqsByStatus } from "@/modules/rfq/service";

export const dynamic = "force-dynamic";

/** Ops RFQ pipeline — concierge matching is a first-class feature (M3) */
export default async function AdminRfqs({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("adminRfq");
  const tStatus = await getTranslations("rfqStatus");

  const grouped = await listRfqsByStatus();
  const pipeline = ["new", "qualified", "dispatched", "offers_in"] as const;
  const closed = ["accepted", "lost", "expired"] as const;

  return (
    <div>
      <h1>{t("title")}</h1>
      <div className="kanban mt" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {pipeline.map((status) => (
          <div key={status} className="column">
            <h3>
              {tStatus(status)} ({grouped[status].length})
            </h3>
            {grouped[status].map((rfq) => (
              <Link
                key={rfq.id}
                href={`/${locale}/admin/rfqs/${rfq.id}`}
                className="item"
                style={{ display: "block" }}
              >
                <strong>{rfq.title}</strong>
                <div className="muted" style={{ fontSize: "0.75rem" }}>
                  {rfq.siteCity ?? "—"} · {new Date(rfq.createdAt).toISOString().slice(0, 10)}
                </div>
              </Link>
            ))}
          </div>
        ))}
      </div>

      <h2>{t("closedTitle")}</h2>
      <table>
        <tbody>
          {closed.flatMap((status) =>
            grouped[status].map((rfq) => (
              <tr key={rfq.id}>
                <td>
                  <Link href={`/${locale}/admin/rfqs/${rfq.id}`}>{rfq.title}</Link>
                </td>
                <td>
                  <span className={`badge ${status === "accepted" ? "approved" : ""}`}>
                    {tStatus(status)}
                  </span>
                </td>
                <td className="muted">
                  {new Date(rfq.statusChangedAt).toISOString().slice(0, 10)}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  );
}
