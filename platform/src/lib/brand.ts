/**
 * Piotrr — single source of truth for the brand.
 *
 * The product name lives here, never as a hand-typed string scattered
 * through components. System-owned surfaces (metadata, chrome, e-mail,
 * documents) read from this object so a future rename is one edit, not a
 * grep-and-pray. Canonical spelling and casing are enforced by
 * `brand.test.ts` and by `scripts/brand-check.sh` in CI.
 *
 * Casing rules:
 *   - `name`     "Piotrr"     — running text, the product's name
 *   - `wordmark` "PIOTRR"     — the visual wordmark / graphic headings only
 *   - `slug`     "piotrr"     — URLs, code identifiers, technical names
 *   - `domain`   "piotrr.com" — when the domain is written out
 * Never a mixed form (PiotRR, PioTrr, …). The wordmark is a typographic
 * treatment of the same name, not a second product name.
 */
export const brand = {
  name: "Piotrr",
  wordmark: "PIOTRR",
  slug: "piotrr",
  domain: "piotrr.com",
  url: "https://piotrr.com",
  tagline: "Europe, ready to deliver.",
  descriptor:
    "The European marketplace for products, production and skilled services.",

  // Localised brand lines, kept beside the canonical English so copy never
  // drifts from the wordmark.
  taglineSv: "Europa, redo att leverera.",
  descriptorSv:
    "Den europeiska marknadsplatsen för produkter, produktion och kvalificerade tjänster.",

  /**
   * The brand is not the legal entity. A registered company name belongs on
   * contracts, invoices and the privacy policy — and must never be invented.
   * These stay `null` until a real entity is supplied; surfaces that would
   * show one render "Piotrr is a product operated by …" only when set.
   */
  legalEntityName: null as string | null,
  billingEntityName: null as string | null,
  contractingEntityName: null as string | null,
} as const;

export type Brand = typeof brand;
