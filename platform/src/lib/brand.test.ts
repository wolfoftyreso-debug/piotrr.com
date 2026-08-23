import { describe, expect, it } from "vitest";
import { brand } from "./brand";

/**
 * The canonical brand values are load-bearing: metadata, e-mail, documents
 * and the wordmark all read from them. This locks the exact spelling and
 * casing so a careless edit (a dropped `r`, a stray capital, a reverted
 * name) fails here instead of shipping.
 */
describe("brand canonical values", () => {
  it("spells the name Piotrr, six letters, one capital", () => {
    expect(brand.name).toBe("Piotrr");
    expect(brand.name).toMatch(/^Piotrr$/);
  });

  it("renders the wordmark as PIOTRR", () => {
    expect(brand.wordmark).toBe("PIOTRR");
    expect(brand.wordmark).toBe(brand.name.toUpperCase());
  });

  it("uses the lowercase technical slug piotrr", () => {
    expect(brand.slug).toBe("piotrr");
    expect(brand.slug).toBe(brand.name.toLowerCase());
  });

  it("points at piotrr.com", () => {
    expect(brand.domain).toBe("piotrr.com");
    expect(brand.url).toBe("https://piotrr.com");
    expect(brand.url).toBe(`https://${brand.domain}`);
  });

  it("carries the tagline and descriptor, both languages", () => {
    expect(brand.tagline).toBe("Europe, ready to deliver.");
    expect(brand.taglineSv).toBe("Europa, redo att leverera.");
    expect(brand.descriptor).toContain("European marketplace");
    expect(brand.descriptorSv).toContain("europeiska marknadsplatsen");
  });

  it("never carries an old name or a misspelling", () => {
    const blob = JSON.stringify(brand).toLowerCase();
    for (const bad of [
      "baltic",
      "piotr ", // Piotr as a standalone word
      "piotor",
      "piotorr",
      "piotrrr",
      "pjotr",
    ]) {
      expect(blob).not.toContain(bad);
    }
    // The correct name must not accidentally read as "Piotr" (5 letters).
    expect(/piotr(?!r)/.test(blob)).toBe(false);
  });

  it("does not invent a legal entity", () => {
    expect(brand.legalEntityName).toBeNull();
    expect(brand.billingEntityName).toBeNull();
    expect(brand.contractingEntityName).toBeNull();
  });
});
