import type { Metadata } from "next";
import { localizedName } from "@/modules/catalog/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { currentActor } from "@/lib/auth";
import { countryName } from "@/lib/countries";
import { listCorridors, listTrades } from "@/modules/catalog/service";
import SiteChrome from "@/app/[locale]/site-chrome";
import { localeAlternates } from "@/lib/seo";
import { submitRfqAction } from "./actions";

export const dynamic = "force-dynamic";

/** Endonyms — a destination reads the same in every UI language. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "requestWork" });
  return {
    title: t("title"),
    description: t("subtitle"),
    alternates: localeAlternates(locale, "/request-work"),
  };
}

/** Buyer RFQ form — public + logged-in, Blocket-simple (Section 5/M3) */
export default async function RequestWork({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("requestWork");
  const actor = await currentActor();
  const [trades, corridors] = await Promise.all([listTrades(), listCorridors()]);
  const destinations = [...new Set(corridors.map((c) => c.toCountry))].sort();

  return (
    <SiteChrome locale={locale}>
      <div className="main" style={{ margin: "0 auto", maxWidth: 720 }}>
        <h1>{t("title")}</h1>
        <p className="muted">{t("subtitle")}</p>

        <form action={submitRfqAction} className="card mt" style={{ display: "grid", gap: "0.85rem" }}>
          <input type="hidden" name="locale" value={locale} />

          {!actor && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div>
                <label htmlFor="buyerName">{t("yourName")} *</label>
                <input id="buyerName" name="buyerName" required style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="buyerEmail">{t("yourEmail")} *</label>
                <input id="buyerEmail" name="buyerEmail" type="email" required style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="buyerCompanyName">{t("yourCompany")} *</label>
                <input id="buyerCompanyName" name="buyerCompanyName" required style={{ width: "100%" }} />
              </div>
              <div>
                <label htmlFor="buyerOrgNumber">{t("yourOrgNumber")} *</label>
                <input id="buyerOrgNumber" name="buyerOrgNumber" required style={{ width: "100%" }} />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="title">{t("rfqTitle")} *</label>
            <input
              id="title"
              name="title"
              required
              minLength={5}
              placeholder={t("rfqTitlePlaceholder")}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label htmlFor="description">{t("description")} *</label>
            <textarea
              id="description"
              name="description"
              required
              minLength={20}
              rows={5}
              placeholder={t("descriptionPlaceholder")}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div>
              <label htmlFor="tradeId">{t("trade")}</label>
              <select id="tradeId" name="tradeId" style={{ width: "100%" }}>
                <option value="">—</option>
                {trades.map((trade) => (
                  <option key={trade.id} value={trade.id}>
                    {localizedName(trade, locale)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="headcountNeeded">{t("headcount")}</label>
              <input id="headcountNeeded" name="headcountNeeded" type="number" min={1} style={{ width: "100%" }} />
            </div>
            <div>
              <label htmlFor="startDate">{t("startDate")}</label>
              <input id="startDate" name="startDate" type="date" style={{ width: "100%" }} />
            </div>
            <div>
              <label htmlFor="durationWeeks">{t("duration")}</label>
              <input id="durationWeeks" name="durationWeeks" type="number" min={1} style={{ width: "100%" }} />
            </div>
            <div>
              <label htmlFor="siteCountry">{t("siteCountry")}</label>
              <select id="siteCountry" name="siteCountry" defaultValue="SE" style={{ width: "100%" }}>
                {destinations.map((cc) => (
                  <option key={cc} value={cc}>
                    {countryName(cc, locale)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="siteCity">{t("siteCity")}</label>
              <input id="siteCity" name="siteCity" style={{ width: "100%" }} />
            </div>
            <div>
              <label htmlFor="siteAddress">{t("siteAddress")}</label>
              <input id="siteAddress" name="siteAddress" style={{ width: "100%" }} />
            </div>
            <div>
              <label htmlFor="workingLanguage">{t("workingLanguage")}</label>
              <select id="workingLanguage" name="workingLanguage" style={{ width: "100%" }}>
                <option value="">—</option>
                <option value="en">English</option>
                <option value="sv">Svenska</option>
                <option value="lt">Lietuvių</option>
                <option value="lv">Latviešu</option>
                <option value="et">Eesti</option>
                <option value="pl">Polski</option>
                <option value="de">Deutsch</option>
                <option value="da">Dansk</option>
                <option value="ru">Русский</option>
              </select>
            </div>
            <div>
              <label htmlFor="budget">{t("budget")}</label>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <input id="budget" name="budget" type="number" min={0} step="1000" style={{ flex: 1 }} />
                <select name="budgetCurrency" defaultValue="SEK">
                  <option value="SEK">SEK</option>
                  <option value="EUR">EUR</option>
                  <option value="DKK">DKK</option>
                  <option value="NOK">NOK</option>
                  <option value="PLN">PLN</option>
                  <option value="CZK">CZK</option>
                </select>
              </div>
            </div>
          </div>

          <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            {t("conciergeNote")}
          </p>
          <div>
            <button type="submit">{t("cta")}</button>
          </div>
        </form>
      </div>
    </SiteChrome>
  );
}
