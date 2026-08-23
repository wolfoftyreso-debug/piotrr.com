/**
 * Accept a URL only if it is an ordinary web link.
 *
 * User-supplied URLs (a supplier's `website`, an import `sourceUrl`) end up
 * in an `<a href>` on a public page. Without a scheme allowlist a value like
 * `javascript:…` or `data:…` turns that link into click-driven XSS or
 * phishing. This returns the trimmed URL only when it parses and uses http or
 * https; anything else — a bad scheme, a malformed value, an empty string —
 * comes back as `null` so the caller renders no link and stores nothing.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return trimmed;
}
