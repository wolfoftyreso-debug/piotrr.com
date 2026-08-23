import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { listCompanies } from "@/modules/companies/service";
import { createCompanyAction } from "@/app/[locale]/admin/actions";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("companies");
  const common = await getTranslations("common");

  const rows = await listCompanies();

  return (
    <div>
      <h1>{t("title")}</h1>

      <div className="card mt">
        <h3>{t("newCompany")}</h3>
        <form action={createCompanyAction} className="inline">
          <div>
            <label htmlFor="name">{t("name")}</label>
            <input id="name" name="name" required minLength={2} />
          </div>
          <div>
            <label htmlFor="country">{t("country")}</label>
            <input id="country" name="country" required maxLength={2} defaultValue="LT" style={{ width: 60 }} />
          </div>
          <div>
            <label htmlFor="registrationNumber">{t("registrationNumber")}</label>
            <input id="registrationNumber" name="registrationNumber" />
          </div>
          <div>
            <label htmlFor="vatNumber">{t("vatNumber")}</label>
            <input id="vatNumber" name="vatNumber" />
          </div>
          <div>
            <label htmlFor="city">{t("city")}</label>
            <input id="city" name="city" />
          </div>
          <button type="submit">{common("create")}</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="muted mt">{t("empty")}</p>
      ) : (
        <table className="mt">
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("country")}</th>
              <th>{t("registrationNumber")}</th>
              <th>{t("vatNumber")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((company) => (
              <tr key={company.id}>
                <td>
                  <Link href={`/${locale}/admin/companies/${company.id}`}>
                    {company.name}
                  </Link>
                </td>
                <td>{company.country}</td>
                <td>{company.registrationNumber ?? "—"}</td>
                <td>{company.vatNumber ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
