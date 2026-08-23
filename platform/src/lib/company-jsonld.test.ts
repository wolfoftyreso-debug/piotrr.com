import { describe, expect, it } from "vitest";
import { buildCompanyJsonLd } from "./company-jsonld";

describe("buildCompanyJsonLd", () => {
  const url = "https://piotrr.example/sv/company/acme-uab";

  it("emits the public Organization fields", () => {
    const ld = buildCompanyJsonLd(
      { name: "Acme UAB", city: "Kaunas", country: "LT", yearFounded: 2015, headcount: 12 },
      url,
    );
    expect(ld["@type"]).toBe("Organization");
    expect(ld.name).toBe("Acme UAB");
    expect(ld.url).toBe(url);
    expect(ld.foundingDate).toBe("2015");
    expect(ld.numberOfEmployees).toBe(12);
    expect((ld.address as { addressCountry: string }).addressCountry).toBe("LT");
  });

  it("never emits a VAT identifier, even when tax data is on file", () => {
    // The public API and publicCompanyView both withhold VAT; the JSON-LD
    // served to crawlers must do the same. Pass a broadened object carrying a
    // vatNumber to prove nothing copies it through.
    const withVat = {
      name: "Acme UAB",
      city: "Kaunas",
      country: "LT",
      yearFounded: 2015,
      headcount: 12,
      vatNumber: "LT100001738712",
    };
    const ld = buildCompanyJsonLd(withVat, url);
    const serialized = JSON.stringify(ld).toLowerCase();
    expect(serialized).not.toContain("vat");
    expect(serialized).not.toContain("100001738712");
    expect("vatID" in ld).toBe(false);
  });

  it("omits optional fields instead of emitting nulls", () => {
    const ld = buildCompanyJsonLd(
      { name: "Bare Co", city: null, country: "SE", yearFounded: null, headcount: null },
      url,
    );
    expect(ld.foundingDate).toBeUndefined();
    expect(ld.numberOfEmployees).toBeUndefined();
    expect((ld.address as { addressLocality?: string }).addressLocality).toBeUndefined();
  });
});
