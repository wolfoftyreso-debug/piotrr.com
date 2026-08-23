import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/service";
import { apiKeys, users } from "./schema";
import { hashToken, safeEqual } from "./session";
import { requireAnyRole, type Actor, type Role } from "./rbac";

/**
 * Machine credentials for the outward API (`/api/v1`).
 *
 * Format: `bb_<prefix>_<secret>` — the prefix is public and indexed, so a
 * presented key is one indexed lookup rather than a scan over every row.
 * Only SHA-256(secret) is stored, and the full key is shown exactly once.
 */

const KEY_PREFIX = "bb";
/**
 * `bb_<12 hex>_<secret>`. The secret is base64url, whose alphabet includes
 * `_` — so this must be anchored and greedy on the tail rather than a
 * naive split on "_", which would tear roughly half of all secrets apart.
 */
const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}_([0-9a-f]{12})_(.+)$`);

export type ApiKeyRow = typeof apiKeys.$inferSelect;

export interface ApiKeyPrincipal {
  userId: string;
  role: Role;
  keyId: string;
  scopes: string[];
}

/**
 * Scopes are coarse on purpose, but they must actually GATE writes: RBAC in
 * the service layer stops the wrong *role*, while the scope stops a key that
 * was deliberately minted read-only (or narrow) from doing more than it was
 * issued for. A write route therefore requires its `:write` scope — a key
 * with only `:read` scopes cannot mutate even if its account could.
 */
export const API_SCOPES = [
  "companies:read",
  "companies:write",
  "verification:read",
  "verification:write",
  "rfqs:read",
  "rfqs:write",
  "offers:read",
  "offers:write",
  "messages:read",
  "messages:write",
  "documents:write",
  "deals:read",
  "profile:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export async function createApiKey(
  actor: Actor,
  input: {
    name: string;
    userId: string;
    scopes: string[];
    expiresAt?: Date | null;
  },
): Promise<{ key: ApiKeyRow; plaintext: string }> {
  // Minting a credential that acts as another account is an admin act.
  requireAnyRole(actor, ["admin"]);

  const unknown = input.scopes.filter(
    (s) => !(API_SCOPES as readonly string[]).includes(s),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown scope(s): ${unknown.join(", ")}`);
  }

  const owner = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
  });
  if (!owner || !owner.active || owner.deletedAt) {
    throw new Error("API keys can only be issued to an active account");
  }

  const prefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `${KEY_PREFIX}_${prefix}_${secret}`;

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(apiKeys)
      .values({
        prefix,
        secretHash: hashToken(secret),
        name: input.name,
        userId: input.userId,
        scopes: input.scopes,
        createdBy: actor.userId,
        expiresAt: input.expiresAt ?? null,
      })
      .returning();
    if (!created) throw new Error("API key insert failed");

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "api_key",
      entityId: created.id,
      action: "api_key.created",
      // The secret is never audited — only what the key can do.
      after: { prefix, name: input.name, userId: input.userId, scopes: input.scopes },
    });
    return created;
  });

  return { key: row, plaintext };
}

/**
 * Authenticate a presented key. Returns null for every failure — unknown,
 * malformed, revoked, expired, or belonging to a suspended account.
 */
export async function authenticateApiKey(
  presented: string,
): Promise<ApiKeyPrincipal | null> {
  const match = KEY_PATTERN.exec(presented.trim());
  if (!match) return null;
  const [, prefix, secret] = match as unknown as [string, string, string];

  const [row] = await db
    .select({
      keyId: apiKeys.id,
      secretHash: apiKeys.secretHash,
      scopes: apiKeys.scopes,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      userId: users.id,
      role: users.role,
      active: users.active,
      deletedAt: users.deletedAt,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.prefix, prefix))
    .limit(1);

  if (!row) return null;
  if (!safeEqual(hashToken(secret), row.secretHash)) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  if (!row.active || row.deletedAt) return null;

  // One write per minute at most; the timestamp is for revocation triage,
  // not analytics, so it does not need to be exact.
  const stale =
    !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000;
  if (stale) {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.keyId));
  }

  return {
    userId: row.userId,
    role: row.role as Role,
    keyId: row.keyId,
    scopes: row.scopes,
  };
}

export function hasScope(principal: ApiKeyPrincipal, scope: ApiScope): boolean {
  return principal.scopes.includes(scope);
}

export async function revokeApiKey(actor: Actor, keyId: string): Promise<void> {
  requireAnyRole(actor, ["admin"]);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
      .returning();
    if (!row) return;

    await writeAudit(tx, {
      actorId: actor.userId,
      entityType: "api_key",
      entityId: keyId,
      action: "api_key.revoked",
      before: { revokedAt: null },
      after: { revokedAt: row.revokedAt },
    });
  });
}

export async function listApiKeys(actor: Actor): Promise<ApiKeyRow[]> {
  requireAnyRole(actor, ["ops", "admin"]);
  return db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
}
