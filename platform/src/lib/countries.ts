/**
 * Country names in the reader's language.
 *
 * `Intl.DisplayNames` is stdlib, so this costs no dependency and covers
 * all eight locales — a Danish buyer reads "Tyskland", a German one
 * "Deutschland". Two hand-written maps used to do this in one language
 * each; a verification badge that says "SE" or names the country in the
 * wrong language is worse than the badge itself.
 */

const cache = new Map<string, Intl.DisplayNames>();

function displayNames(locale: string): Intl.DisplayNames | null {
  const cached = cache.get(locale);
  if (cached) return cached;
  try {
    const dn = new Intl.DisplayNames([locale], { type: "region" });
    cache.set(locale, dn);
    return dn;
  } catch {
    return null;
  }
}

/** ISO 3166-1 alpha-2 → localized name. Falls back to the code itself. */
export function countryName(code: string, locale: string): string {
  const upper = code.trim().toUpperCase();
  if (upper.length !== 2) return code;
  try {
    return displayNames(locale)?.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

/** "Sverige, Tyskland" — for a badge covering several destinations. */
export function countryNames(codes: string[], locale: string): string {
  return codes.map((c) => countryName(c, locale)).join(", ");
}
