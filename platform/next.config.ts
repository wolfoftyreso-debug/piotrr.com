import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { buildCsp } from "./src/lib/csp";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProd = process.env.NODE_ENV === "production";

/**
 * Security headers.
 *
 * The app renders on the server and ships no third-party scripts, so the
 * policy can be tight. Two concessions to the framework:
 *  - `'unsafe-inline'` on style-src: the pages use inline `style=` props.
 *  - `'unsafe-inline'` on script-src: Next's bootstrap emits inline
 *    scripts without a nonce in the App Router's static paths. Removing
 *    it needs a nonce plumbed through the root layout and a switch to
 *    fully dynamic rendering — tracked as a known gap rather than
 *    claimed as done.
 *
 * `connect-src`/`img-src` allow the S3/MinIO origin because the browser
 * uploads and fetches evidence directly against a presigned URL.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Only meaningful over TLS; the ingress terminates it in production.
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // One container image per Section 3
  output: "standalone",
  // Do not advertise the framework version to a scanner.
  poweredByHeader: false,
  // Next 16 dropped the `eslint` config key; lint runs as its own CI step
  // (lint → typecheck → test → build) and is not part of the build.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Middleware owns the CSP for page routes so it can vary the
        // policy per area; it does not run for these, so they get the
        // baseline here. Emitting it in both places would send two
        // CSP headers and the browser would enforce the intersection.
        source: "/:path*.:ext(js|css|svg|png|jpg|jpeg|webp|ico|woff|woff2|txt|xml|json)",
        headers: [
          { key: "Content-Security-Policy", value: buildCsp({ isProd }) },
        ],
      },
      {
        // The API is same-origin only. No CORS headers are emitted, so a
        // cross-origin XHR is refused by the browser by default; this
        // makes the intent explicit and stops caches storing responses.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Vary", value: "Origin" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
