import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", [
  "admin",
  "ops",
  "supplier",
  "buyer",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // PII: email address
  email: text("email").notNull().unique(),
  // PII: person name
  name: text("name"),
  role: userRole("role").notNull().default("buyer"),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  /** Buyers carry beställaransvar, so a request must identify who they are:
   *  organisation number plus a mailbox they have proven they control. */
  buyerOrgNumber: text("buyer_org_number"),
  buyerCompanyName: text("buyer_company_name"),
  buyerCountry: text("buyer_country"),
});

/** Magic-link tokens. Table name kept from the Auth.js era so the
 *  migration history stays append-only; the implementation is ours
 *  (`magic-link.ts`): SHA-256 digests, single use, 15-minute lifetime. */
export const verificationTokens = pgTable("auth_verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull().unique(),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

/**
 * Server-side sessions (own auth — Appendix B).
 *
 * The cookie carries an opaque 256-bit token; only its SHA-256 digest is
 * stored, so a database leak does not hand out live sessions. Server-side
 * state is the point: a JWT cannot be revoked, and suspending an ops
 * account has to take effect immediately.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the cookie token, hex. Never the token itself. */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** PII-adjacent: kept for the user's own session list and abuse triage */
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * Machine credentials for the outward API (`/api/v1`).
 *
 * Shown once at creation as `bb_<prefix>_<secret>`; only the secret's
 * SHA-256 digest is stored. The prefix is indexed so a lookup is one row,
 * not a scan-and-compare over every key.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Public, greppable identifier — safe to log and to show in the UI */
    prefix: text("prefix").notNull().unique(),
    secretHash: text("secret_hash").notNull(),
    name: text("name").notNull(),
    /** The account the key acts as; RBAC still applies to that role */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Coarse scopes, e.g. ["companies:read", "rfqs:write"] */
    scopes: text("scopes").array().notNull().default([]),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("api_keys_user_idx").on(t.userId)],
);
