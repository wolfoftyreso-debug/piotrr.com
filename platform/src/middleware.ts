import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { buildCsp, isAuthenticatedArea } from "@/lib/csp";
import { acceptableRequestId, REQUEST_ID_HEADER } from "@/lib/request-context";

const intlMiddleware = createMiddleware(routing);

/** `/sv/portal` yes, `/portal` no — the latter still needs the redirect. */
function hasLocalePrefix(pathname: string): boolean {
  const first = pathname.split("/").filter(Boolean)[0];
  return !!first && (routing.locales as readonly string[]).includes(first);
}

/**
 * Locale routing, with two guards we own rather than inherit.
 *
 * 1. **Open-redirect containment.** next-intl <4.9.1 carries an
 *    open-redirect advisory (GHSA, moderate) and the upgrade is a major
 *    version. Rather than trust the library, every redirect it produces
 *    is checked here: a `Location` pointing anywhere but this origin is
 *    rewritten to the site root. This holds even if the library is
 *    replaced or the advisory turns out to cover a path we did not model.
 *
 * 2. **Cross-origin state change.** Server Actions and API writes arrive
 *    as POST. A cross-site POST cannot carry the SameSite=Lax session
 *    cookie, but a sibling subdomain is same-site, so unsafe methods must
 *    also present an Origin that matches the host.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export default function middleware(request: NextRequest): NextResponse {
  if (UNSAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      const host = request.headers.get("host");
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!host || originHost !== host) {
        // Deliberately terse: an attacker learns nothing from the body.
        return new NextResponse("Cross-origin request rejected", { status: 403 });
      }
    }
  }

  // Pages that hold a session get a nonced policy instead of one that
  // permits any inline script. Next mints the nonce onto its own
  // bootstrap by reading the CSP off the *request*, which is why the
  // header goes on the forwarded request and not only on the response.
  //
  // These routes already carry a locale prefix by the time they are
  // linked to, and they are already rendered per request, so next-intl
  // has no rewriting left to do — going straight to NextResponse.next
  // keeps this on documented API rather than reaching inside the
  // library's response to attach request headers.
  // One id per request, forwarded inward and echoed outward. An id
  // supplied by the trusted proxy is kept so a trace survives the hop;
  // there is no trust placed in it beyond correlation.
  // Honour an inbound id only when it is shaped like one — the header is
  // client-writable and flows into the audit trail (see request-context.ts).
  const inboundId = request.headers.get(REQUEST_ID_HEADER);
  const requestId = acceptableRequestId(inboundId) ? inboundId : crypto.randomUUID();

  const { pathname } = request.nextUrl;
  if (isAuthenticatedArea(pathname) && hasLocalePrefix(pathname)) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const csp = buildCsp({ nonce, isProd: process.env.NODE_ENV === "production" });
    const forwarded = new Headers(request.headers);
    forwarded.set("content-security-policy", csp);
    forwarded.set("x-nonce", nonce);
    forwarded.set(REQUEST_ID_HEADER, requestId);
    const authed = NextResponse.next({ request: { headers: forwarded } });
    authed.headers.set("content-security-policy", csp);
    authed.headers.set(REQUEST_ID_HEADER, requestId);
    return authed;
  }

  // Public pages: the id is echoed on the response so a user can quote it
  // in a ticket, but it is NOT injected into the inward request — that
  // would mean rebuilding next-intl's request and reaching around the
  // library. Server-side correlation on these routes therefore depends on
  // the ingress supplying X-Request-Id (see infra/k8s/base/ingress.yaml);
  // where it does, the header arrives naturally and currentRequestId()
  // picks it up. The authenticated area above does not depend on that.
  const response = intlMiddleware(request);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  // Every other page gets the baseline policy. Middleware owns the CSP
  // for page routes now, so forgetting this line ships pages with no
  // policy at all — which is exactly what happened once.
  response.headers.set(
    "content-security-policy",
    buildCsp({ isProd: process.env.NODE_ENV === "production" }),
  );

  const location = response.headers.get("location");
  if (location) {
    let target: URL | null = null;
    try {
      target = new URL(location, request.nextUrl.origin);
    } catch {
      target = null;
    }
    if (!target || target.origin !== request.nextUrl.origin) {
      const safe = new URL("/", request.nextUrl.origin);
      return NextResponse.redirect(safe, { status: 307 });
    }
  }

  return response;
}

export const config = {
  // Locale routing for pages; API routes and static assets are untouched
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
