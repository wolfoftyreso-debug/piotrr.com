/**
 * Content-Security-Policy, built per request.
 *
 * The policy is not the same everywhere, on purpose.
 *
 * Next's App Router streams the RSC payload through inline `<script>`
 * tags. Removing `'unsafe-inline'` from `script-src` was measured against
 * the running build: all three pages tested rendered *nothing* — the
 * inline bootstrap is load-bearing, not decoration. So the choice is a
 * nonce or nothing, and a nonce has to be minted per response, which opts
 * the page out of static rendering.
 *
 * That cost is not uniform:
 *
 *  - `/admin` and `/portal` are already dynamic — every one of those
 *    routes renders per request regardless. A nonce there costs nothing
 *    and buys the real thing: these are the pages that carry a session
 *    and show other companies' compliance documents.
 *
 *  - The public pages are prerendered — 170 of them across eight
 *    locales, which is what makes the site fast and indexable. Forcing
 *    them dynamic to harden a policy would trade an SEO asset for a
 *    smaller win: they carry no session, and the session cookie is
 *    HttpOnly, so script injected there cannot read it.
 *
 * So: strict with a nonce where a session lives, `'unsafe-inline'` where
 * only public content does. The residual risk on the public pages is
 * real and named in docs/SECURITY-READINESS-2026-08.md — defacement,
 * phishing and redirection are still possible there if an injection ever
 * lands; account takeover through the cookie is not.
 */

const s3Origin = (() => {
  try {
    return process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : "";
  } catch {
    return "";
  }
})();

/** Route prefixes that hold a session and are already rendered per request. */
const AUTHENTICATED = ["admin", "portal"];

/** `/sv/admin/queue` → true. The locale segment sits in front. */
export function isAuthenticatedArea(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  // [locale, area, ...] — the area is the second segment, or the first
  // if a request somehow arrives without a locale prefix.
  return segments.slice(0, 2).some((s) => AUTHENTICATED.includes(s));
}

export function buildCsp(options: { nonce?: string; isProd: boolean }): string {
  const { nonce, isProd } = options;
  const scriptSrc = nonce
    ? // 'strict-dynamic' lets the nonced bootstrap load the chunks it
      // needs without every chunk URL being listed. Browsers that honour
      // it ignore the host-source fallbacks; older ones fall back to
      // 'self', which is still not 'unsafe-inline'.
      `script-src 'nonce-${nonce}' 'strict-dynamic' 'self'`
    : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    "base-uri 'self'",
    // Blocks <base href> and plugin-based exfiltration outright.
    "object-src 'none'",
    scriptSrc,
    // Inline style attributes are used throughout the pages. Unlike
    // script, an inline style cannot execute; the exposure is layout,
    // not code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${s3Origin ? " " + s3Origin : ""}`,
    "font-src 'self'",
    `connect-src 'self'${s3Origin ? " " + s3Origin : ""}`,
    "form-action 'self'",
    // Clickjacking: modern equivalent of X-Frame-Options: DENY.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
