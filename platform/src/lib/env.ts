import { z } from "zod";

/**
 * A boolean from an environment variable.
 *
 * NOT `z.coerce.boolean()`, which is `Boolean(value)` — and every
 * non-empty string is truthy, so `SMTP_SECURE=false` parsed as **true**.
 * That is not a lint-level nit: it made the SMTP client demand implicit
 * TLS on a STARTTLS port, the handshake failed, and every sign-in email
 * was silently dropped while the UI said the link had been sent. The
 * only spelling that produced `false` was the empty string.
 *
 * So the accepted spellings are explicit, and anything else is a
 * configuration error rather than a coin flip.
 */
const envBoolean = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw === "") return fallback;
      const v = raw.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(v)) return true;
      if (["false", "0", "no", "off"].includes(v)) return false;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expected a boolean like true/false, got "${raw}"`,
      });
      return z.NEVER;
    });

/** Zod-validated environment (Section 3). Secrets come from SSM/Secrets
 * Manager at deploy time — never from files in the repo. */
const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://baltic:baltic@localhost:5432/baltic_bridge"),
  AUTH_SECRET: z.string().default("dev-only-change-me"),
  /**
   * Escape hatch for the database TLS requirement below. Deliberately not
   * a silent default: an operator who accepts an unencrypted database
   * connection has to write it down in the deployment, and the process
   * says so on every boot.
   */
  DATABASE_ALLOW_PLAINTEXT: envBoolean(false),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("eu-north-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_DOCUMENTS_BUCKET: z.string().default("documents"),
  S3_FORCE_PATH_STYLE: envBoolean(false),
  /**
   * Largest object a presigned upload may store, in bytes (default 25 MiB).
   * The presigned PUT is signed with this as its Content-Length ceiling so a
   * single supplier cannot mint a URL and stream an arbitrarily large object
   * into the shared bucket. Raise it deliberately for a corridor that needs
   * bigger evidence files.
   */
  S3_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  /**
   * The public origin the app is served from. Sign-in links and other
   * absolute URLs are built from this. It MUST NOT be derived from the
   * request `Host` header in production: an attacker who controls Host
   * could otherwise redirect a victim's one-time sign-in token to their
   * own origin. Optional in dev (falls back to the request host); required
   * and https in production — see assertProductionConfig.
   */
  PUBLIC_BASE_URL: z.string().url().optional(),
  EMAIL_PROVIDER: z.enum(["console", "ses", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("no-reply@piotrr.com"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: envBoolean(false),
  /**
   * Refuse to send mail over an unencrypted SMTP connection. Sign-in links
   * carry a single-use token, so the default is to fail closed: if the relay
   * offers neither implicit TLS nor STARTTLS (or an on-path attacker strips
   * the STARTTLS advertisement), the send is refused rather than leaking the
   * token in plaintext. Set to false only to accept plaintext deliberately.
   */
  SMTP_REQUIRE_TLS: envBoolean(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Malware scanning of the documents bucket (Section 4.7). ClamAV is the
   *  self-hosted answer to GuardDuty Malware Protection for S3. */
  MALWARE_SCANNER: z.enum(["noop", "clamav"]).default("noop"),
  CLAMAV_HOST: z.string().default("clamav"),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
  CLAMAV_MAX_BYTES: z.coerce.number().int().default(64 * 1024 * 1024),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().default(60_000),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

/**
 * Development defaults are a convenience; in production they are a
 * vulnerability that boots successfully. A missing `AUTH_SECRET` would
 * fall back to a value published in this repository, and the database
 * URL would fall back to `baltic:baltic@localhost` — both of which fail
 * silently rather than loudly, which is the wrong way round.
 *
 * So the same schema is strict about production: rather than serve real
 * users on placeholder configuration, every request fails. Verified
 * behaviour, not intent — a container started with the placeholder
 * secret answers 500 on `/api/healthz` as well as on pages, so the
 * readiness probe never passes, the pod never joins the service, and the
 * rollout stops. A bad deploy is loud on the first attempt instead of
 * running for a week before anyone notices.
 */
const PLACEHOLDER_SECRETS = new Set([
  "dev-only-change-me",
  "change-me",
  "changeme",
  "secret",
]);

/**
 * Everything the database carries is either PII or evidence: passwords
 * (hashed, but the session digests next to them are bearer credentials),
 * personnummer-adjacent worker data, and the audit trail that has to hold
 * up if a verification decision is ever disputed. Sending that over a
 * plaintext socket relies on nothing hostile ever running on the same
 * network — which is a property of today's cluster, not of the software.
 *
 * So production requires `sslmode=verify-full`: encrypted *and* the
 * server's certificate checked against a CA we pin, which is the part
 * `require` skips. `require` accepts any certificate, including one an
 * attacker in the path presents, so it is rejected here rather than
 * quietly accepted as "TLS is on".
 *
 * Unix-socket connections are exempt: they never touch a network, and
 * PostgreSQL refuses TLS on them anyway.
 *
 * Returns the problem, or null when the URL is acceptable.
 */
/** IPv4 dotted quad, or the bracketed IPv6 form a URL leaves as hex+colons. */
function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function databaseTlsProblem(url: string, allowPlaintext: boolean): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // shape errors are not this check's business
  }

  // `host=/var/run/postgresql` (or an empty hostname) means a unix socket.
  const socketDir = parsed.searchParams.get("host");
  if (socketDir?.startsWith("/") || parsed.hostname === "") return null;

  const mode = parsed.searchParams.get("sslmode");
  if (mode === "verify-full") {
    /**
     * Measured, not assumed: node-postgres omits the SNI name when the
     * host is an IP literal (`pg/lib/connection.js` — `if (net.isIP(host)
     * === 0) options.servername = host`), and Node then has no name to
     * check the certificate against. Connecting to an address therefore
     * downgrades verify-full to verify-ca *silently* — the URL still says
     * verify-full. Probed against PostgreSQL 16 with a private CA: the
     * DNS name rejects a certificate issued to another name, the IP does
     * not. So an address is a configuration error here.
     */
    if (isIpLiteral(parsed.hostname)) {
      return (
        `DATABASE_URL points at the IP address ${parsed.hostname}: node-postgres ` +
        `sends no SNI name for an address, so sslmode=verify-full does not check ` +
        `the server's identity. Use the DNS name the certificate is issued for.`
      );
    }
    return null;
  }
  if (allowPlaintext) return null;

  const seen = mode ? `sslmode=${mode}` : "no sslmode";
  return (
    `DATABASE_URL uses ${seen} — production requires sslmode=verify-full ` +
    `(with sslrootcert= for a private CA). Set DATABASE_ALLOW_PLAINTEXT=true ` +
    `to accept an unverified database connection deliberately.`
  );
}

function assertProductionConfig(parsed: z.infer<typeof envSchema>): void {
  if (parsed.NODE_ENV !== "production") return;
  const problems: string[] = [];

  if (PLACEHOLDER_SECRETS.has(parsed.AUTH_SECRET)) {
    problems.push("AUTH_SECRET is still the placeholder value");
  } else if (parsed.AUTH_SECRET.length < 32) {
    problems.push("AUTH_SECRET is shorter than 32 characters");
  }
  if (parsed.DATABASE_URL.includes("baltic:baltic@localhost")) {
    problems.push("DATABASE_URL is still the development default");
  }
  if (parsed.EMAIL_PROVIDER === "console") {
    problems.push("EMAIL_PROVIDER is 'console' — sign-in links would go to the log");
  }
  if (!parsed.PUBLIC_BASE_URL) {
    problems.push(
      "PUBLIC_BASE_URL is not set — sign-in links would fall back to the " +
        "request Host header, which an attacker controls",
    );
  } else {
    let origin: URL | null = null;
    try {
      origin = new URL(parsed.PUBLIC_BASE_URL);
    } catch {
      origin = null;
    }
    // Loopback is allowed to be http:// — that is CI's in-cluster server,
    // which has no TLS material. A real public origin must be https so the
    // one-time sign-in token is never carried over plaintext.
    const loopback =
      origin !== null &&
      (origin.hostname === "127.0.0.1" ||
        origin.hostname === "localhost" ||
        origin.hostname === "::1");
    if (origin && origin.protocol !== "https:" && !loopback) {
      problems.push("PUBLIC_BASE_URL must be an https:// origin in production");
    }
  }
  const tls = databaseTlsProblem(parsed.DATABASE_URL, parsed.DATABASE_ALLOW_PLAINTEXT);
  if (tls) problems.push(tls);

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with unsafe configuration:\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
  }
}

const parsedEnv = envSchema.parse(process.env);

/**
 * `next build` runs with NODE_ENV=production but without the deployment's
 * secrets — it prerenders pages, it does not serve anyone. Enforcing the
 * guard there would only teach people to put real secrets in the build
 * environment, which is the opposite of the point. The check belongs to
 * the serving process, where it runs on the container's first request.
 */
const isBuildPhase = process.env.NEXT_PHASE?.startsWith("phase-production-build");
if (!isBuildPhase) {
  assertProductionConfig(parsedEnv);

  // An accepted risk should still be visible. console, not pino: this runs
  // at module load, before the logger any caller configures, and the line
  // has to survive whatever the importer does afterwards.
  if (
    parsedEnv.NODE_ENV === "production" &&
    parsedEnv.DATABASE_ALLOW_PLAINTEXT &&
    databaseTlsProblem(parsedEnv.DATABASE_URL, false)
  ) {
    console.warn(
      "[env] DATABASE_ALLOW_PLAINTEXT is set: database traffic is not " +
        "verified TLS. Anything on the path between the app and Postgres " +
        "can read credentials, PII and the audit trail.",
    );
  }
}

export const env = parsedEnv;

/** Exported for the test suite — the guard is the thing under test. */
export const __testing = { assertProductionConfig, envSchema };
