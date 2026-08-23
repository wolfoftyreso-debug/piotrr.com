import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { brand } from "@/lib/brand";

const BASE_URL = process.env.PUBLIC_BASE_URL ?? brand.url;

/**
 * Canonical + hreflang alternates for a locale-prefixed path.
 * Without these, the six language variants of a page compete with each
 * other in search results instead of being grouped as one page.
 *
 * `path` is the part after the locale, with a leading slash or empty for
 * the locale root: "" | "/suppliers" | "/request-work".
 */
export function localeAlternates(locale: string, path = ""): Metadata["alternates"] {
  return {
    canonical: `${BASE_URL}/${locale}${path}`,
    languages: Object.fromEntries(
      routing.locales.map((l) => [l, `${BASE_URL}/${l}${path}`]),
    ),
  };
}
