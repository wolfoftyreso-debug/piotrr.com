/**
 * schema.org `Organization` JSON-LD for a public company profile.
 *
 * This is served to every anonymous visitor and crawler, so it is held to the
 * SAME exposure rule as the public API projection (`publicCompanyView`): only
 * fields the product is willing to publish appear here. In particular there is
 * NO `vatID`. VAT is an internal CRM field — the public API omits it and the
 * security suite asserts it never reaches the public projection; the trust
 * signal buyers see is F-skatt/verification in the verified panel, not the raw
 * tax id. The input type is a narrow allowlist (no `vatNumber` field at all),
 * so a future edit cannot reintroduce the leak without also widening the type.
 */
export interface CompanyJsonLdInput {
  name: string;
  city: string | null;
  country: string;
  yearFounded: number | null;
  headcount: number | null;
}

export function buildCompanyJsonLd(
  company: CompanyJsonLdInput,
  url: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: company.name,
    url,
    address: {
      "@type": "PostalAddress",
      addressLocality: company.city ?? undefined,
      addressCountry: company.country,
    },
    foundingDate: company.yearFounded ? String(company.yearFounded) : undefined,
    numberOfEmployees: company.headcount ?? undefined,
  };
}
