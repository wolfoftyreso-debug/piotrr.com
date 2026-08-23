import { describe, expect, it } from "vitest";
import { __testing } from "./env";

const { assertProductionConfig, envSchema } = __testing;

/**
 * The production configuration guard. Development defaults exist so the
 * app starts on a fresh clone; the danger is that they also let it start
 * in production, serving real users on a secret published in this
 * repository. These cases assert it refuses instead.
 */
function config(overrides: Record<string, string>) {
  return envSchema.parse({
    NODE_ENV: "production",
    AUTH_SECRET: "a".repeat(48),
    DATABASE_URL:
      "postgres://app:realpassword@db.internal:5432/baltic_bridge" +
      "?sslmode=verify-full&sslrootcert=/etc/pg-tls/ca.crt",
    EMAIL_PROVIDER: "smtp",
    PUBLIC_BASE_URL: "https://www.example.com",
    ...overrides,
  });
}

describe("production configuration guard", () => {
  it("accepts a fully configured production environment", () => {
    expect(() => assertProductionConfig(config({}))).not.toThrow();
  });

  it("refuses the placeholder auth secret", () => {
    expect(() => assertProductionConfig(config({ AUTH_SECRET: "dev-only-change-me" })))
      .toThrow(/AUTH_SECRET/);
    expect(() => assertProductionConfig(config({ AUTH_SECRET: "change-me" })))
      .toThrow(/AUTH_SECRET/);
  });

  it("refuses an auth secret with too little entropy to be one", () => {
    expect(() => assertProductionConfig(config({ AUTH_SECRET: "short" })))
      .toThrow(/32 characters/);
  });

  it("refuses the development database credentials", () => {
    expect(() =>
      assertProductionConfig(
        config({ DATABASE_URL: "postgres://baltic:baltic@localhost:5432/baltic_bridge" }),
      ),
    ).toThrow(/DATABASE_URL/);
  });

  it("refuses to send sign-in links to the log", () => {
    expect(() => assertProductionConfig(config({ EMAIL_PROVIDER: "console" })))
      .toThrow(/EMAIL_PROVIDER/);
  });

  it("refuses a production boot with no PUBLIC_BASE_URL — the Host header must never set a sign-in link origin", () => {
    const parsed = envSchema.parse({
      NODE_ENV: "production",
      AUTH_SECRET: "a".repeat(48),
      DATABASE_URL:
        "postgres://app:realpassword@db.internal:5432/baltic_bridge" +
        "?sslmode=verify-full&sslrootcert=/etc/pg-tls/ca.crt",
      EMAIL_PROVIDER: "smtp",
      // PUBLIC_BASE_URL intentionally omitted
    });
    expect(() => assertProductionConfig(parsed)).toThrow(/PUBLIC_BASE_URL/);
  });

  it("refuses a non-https PUBLIC_BASE_URL", () => {
    expect(() => assertProductionConfig(config({ PUBLIC_BASE_URL: "http://www.example.com" })))
      .toThrow(/https/);
  });

  it("reports every problem at once, so one deploy fixes them all", () => {
    try {
      assertProductionConfig(
        config({
          AUTH_SECRET: "change-me",
          DATABASE_URL: "postgres://baltic:baltic@localhost:5432/baltic_bridge",
          EMAIL_PROVIDER: "console",
        }),
      );
      throw new Error("guard did not fire");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("AUTH_SECRET");
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("EMAIL_PROVIDER");
    }
  });

  // Postgres carries the audit trail, the session digests and the worker
  // PII. "TLS is on" is not the bar — `require` accepts any certificate,
  // including one presented by whatever is in the path.
  it("refuses an unencrypted database connection", () => {
    expect(() =>
      assertProductionConfig(
        config({ DATABASE_URL: "postgres://app:pw@db.internal:5432/bb" }),
      ),
    ).toThrow(/sslmode=verify-full/);
    expect(() =>
      assertProductionConfig(
        config({ DATABASE_URL: "postgres://app:pw@db.internal:5432/bb?sslmode=disable" }),
      ),
    ).toThrow(/sslmode=verify-full/);
  });

  it("refuses TLS that does not verify the server", () => {
    for (const mode of ["require", "prefer", "verify-ca", "no-verify"]) {
      expect(() =>
        assertProductionConfig(
          config({ DATABASE_URL: `postgres://app:pw@db.internal:5432/bb?sslmode=${mode}` }),
        ),
        mode,
      ).toThrow(/sslmode=verify-full/);
    }
  });

  // Probed against PostgreSQL 16: with a DNS name, a certificate issued
  // to another name is rejected; with an IP literal the same connection
  // succeeds, because node-postgres sends no SNI name for an address.
  // verify-full to an IP is verify-ca wearing its badge.
  it("refuses verify-full to an IP address, which does not verify anything", () => {
    expect(() =>
      assertProductionConfig(
        config({ DATABASE_URL: "postgres://app:pw@10.0.1.5:5432/bb?sslmode=verify-full" }),
      ),
    ).toThrow(/no SNI name/);
    expect(() =>
      assertProductionConfig(
        config({ DATABASE_URL: "postgres://app:pw@[fd00::5]:5432/bb?sslmode=verify-full" }),
      ),
    ).toThrow(/no SNI name/);
  });

  it("exempts unix sockets, which never touch a network", () => {
    expect(() =>
      assertProductionConfig(
        config({ DATABASE_URL: "postgres://app@/baltic_bridge?host=/var/run/postgresql" }),
      ),
    ).not.toThrow();
  });

  it("allows plaintext only when it is written down", () => {
    expect(() =>
      assertProductionConfig(
        config({
          DATABASE_URL: "postgres://app:pw@db.internal:5432/bb",
          DATABASE_ALLOW_PLAINTEXT: "true",
        }),
      ),
    ).not.toThrow();
  });

  it("leaves development alone", () => {
    const dev = envSchema.parse({ NODE_ENV: "development" });
    expect(() => assertProductionConfig(dev)).not.toThrow();
  });
});

describe("boolean environment variables", () => {
  // The bug this pins: z.coerce.boolean() is Boolean(value), so the
  // string "false" was true. SMTP_SECURE=false therefore demanded
  // implicit TLS on a STARTTLS port and every sign-in email was dropped
  // silently, while the UI reported the link as sent.
  it("reads 'false' as false, not as a truthy string", () => {
    expect(envSchema.parse({ SMTP_SECURE: "false" }).SMTP_SECURE).toBe(false);
    expect(envSchema.parse({ S3_FORCE_PATH_STYLE: "false" }).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("accepts the spellings an operator actually types", () => {
    for (const t of ["true", "TRUE", " 1 ", "yes", "on"]) {
      expect(envSchema.parse({ SMTP_SECURE: t }).SMTP_SECURE, t).toBe(true);
    }
    for (const f of ["false", "FALSE", "0", "no", "off"]) {
      expect(envSchema.parse({ SMTP_SECURE: f }).SMTP_SECURE, f).toBe(false);
    }
  });

  it("falls back when unset or empty", () => {
    expect(envSchema.parse({}).SMTP_SECURE).toBe(false);
    expect(envSchema.parse({ SMTP_SECURE: "" }).SMTP_SECURE).toBe(false);
  });

  it("refuses a value it cannot read rather than guessing", () => {
    expect(() => envSchema.parse({ SMTP_SECURE: "maybe" })).toThrow();
  });
});
